/*
 * Test structurel du graphe du moteur (engine/sc/graph.scd).
 *
 * Serveur dédié \mxtest sur 127.0.0.1:57140, sortie MME (jamais ASIO), sans
 * entrée matérielle : sur ce poste, l'ouverture d'une entrée MME ou DirectSound
 * échoue ('Unanticipated host error'). SoundIn lit alors au-delà des canaux
 * matériels, ce qui suffit : le test vérifie la structure par /g_queryTree,
 * pas le signal.
 * Les sorties Master et Cue sont mises à volume 0 avant l'ajout des sources.
 * Verdict : "MX-TEST-OK" ou "MX-TEST-FAIL <raison>", puis 0.exit.
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var server = Server(\mxtest, NetAddr("127.0.0.1", 57140));
var done = false;
var finish, fail, check, query, parse, sourceTree, expectChain, defaultProc, compBand;

finish = { |line|
  if(done.not) {
    done = true;
    line.postln;
    server.quit;
    SystemClock.sched(1.5, { 0.exit; nil });
  };
};
fail = { |reason| finish.("MX-TEST-FAIL " ++ reason) };
check = { |condition, reason| if(condition.not) { Error(reason).throw } };

compBand = { (thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0, bypass: 1) };
defaultProc = {
  (
    mix: (volume: 1, cue: 0, mute: 0, balance: 0.5),
    input: (gain: 1),
    inputCompressor: compBand.(),
    eq: (low: 0.5, mid: 0.5, high: 0.5),
    hp: (enabled: 0, model: \BHiPass, freq: 0, q: 1, mul: 1, add: 0),
    lp: (enabled: 0, model: \BLowPass, freq: 1, q: 1, gain: 2, mul: 1, add: 0),
    pitch: (semitones: 0),
    bandCompressor: (low: compBand.(), mid: compBand.(), high: compBand.())
  )
};

// Arbre /g_queryTree (flag 0) : id, nombre d'enfants (-1 pour un Synth), nom de SynthDef.
parse = { |msg, index|
  var id = msg[index];
  var count = msg[index + 1];
  var next = index + 2;
  var node;
  if(count == -1) {
    node = (id: id, def: msg[index + 2].asString);
    next = index + 3;
  } {
    node = (id: id, children: List.new);
    count.do {
      var result = parse.(msg, next);
      node[\children].add(result[0]);
      next = result[1];
    };
  };
  [node, next]
};

query = { |groupId|
  var reply = nil;
  var tries = 0;
  var responder = OSCFunc({ |msg| if(msg[2] == groupId) { reply = msg } }, '/g_queryTree.reply', server.addr);
  server.sendMsg('/g_queryTree', groupId, 0);
  while { reply.isNil and: { tries < 60 } } { 0.05.wait; tries = tries + 1 };
  responder.free;
  check.(reply.notNil, "pas de réponse /g_queryTree pour " ++ groupId);
  parse.(reply, 2)[0]
};

sourceTree = { |id| query.(~mxSources[id][\group].nodeID) };

expectChain = { |id, width, kinds|
  var tree = sourceTree.(id);
  var expected = kinds.collect { |kind| "mx_" ++ kind ++ "_" ++ width };
  var defs = tree[\children].collect { |child| child[\def] }.asArray;
  var ids = tree[\children].collect { |child| child[\id] }.asArray;
  check.(defs == expected, id ++ " : étages " ++ defs ++ " au lieu de " ++ expected);
  check.(ids == ~mxNodeIds.(id), id ++ " : ~mxNodeIds " ++ ~mxNodeIds.(id) ++ " différent de l'arbre " ++ ids);
};

SystemClock.sched(50, { fail.("délai dépassé dans le test sclang"); nil });

server.options.device = "MME : Mappeur de sons Microsoft - Output";
server.options.numInputBusChannels = 0;
server.options.numOutputBusChannels = 4;
server.options.ugenPluginsPath = [Platform.resourceDir +/+ "plugins", root +/+ "sc" +/+ "plugins"];

(root +/+ "sc" +/+ "graph.scd").load;

server.waitForBoot({
  try {
    var neutral = [\in, \eqdirect, \hp, \lp, \pitch, \dyn, \mix];
    var errors, tasks, groupsBefore, groupsAfter, defaultTree, sourcesTree, outputTree, outputDefs, ids1, ids3, removedGroup, raised;
    ("MX-TEST-SCSYNTH-PID " ++ server.pid).postln;

    ~mxInit.(server, 256);
    check.(~mxModels == (Compander: true, CompanderD: true, FaustRMS: true), "modèles de compresseur " ++ ~mxModels);
    ~mxSetOutputStage.(\master, \mix, (volume: 0));
    ~mxSetOutputStage.(\cue, \mix, (volume: 0));

    // Groupes : sources avant sorties.
    defaultTree = query.(server.defaultGroup.nodeID);
    check.(defaultTree[\children].collect { |c| c[\id] }.indexOf(~mxSourcesGroup.nodeID).notNil, "groupe des sources absent");
    check.(defaultTree[\children].collect { |c| c[\id] }.indexOf(~mxSourcesGroup.nodeID)
      < defaultTree[\children].collect { |c| c[\id] }.indexOf(~mxOutputGroup.nodeID), "sources après sorties");

    // Sorties : un processeur et un écrivain par sortie.
    outputTree = query.(~mxOutputGroup.nodeID);
    outputDefs = outputTree[\children].collect { |c| c[\def] }.asArray.sort;
    check.(outputDefs == ["mx_output_compander", "mx_output_compander", "mx_output_writer", "mx_output_writer"],
      "sorties inattendues " ++ outputDefs);

    // Construction des SynthDefs par largeur, sans reconstruction.
    check.([1, 2, 5].collect { |w| ~mxEnsureWidth.(w) } == [true, true, true], "~mxEnsureWidth ne construit pas");
    check.([1, 2, 5].collect { |w| ~mxEnsureWidth.(w) } == [false, false, false], "~mxEnsureWidth reconstruit");

    ~mxAddSource.("src-1", 1, 1, 1, defaultProc.());
    ~mxAddSource.("src-2", 2, 2, 2, defaultProc.());
    ~mxAddSource.("src-3", 3, 4, 5, defaultProc.());
    server.sync;

    expectChain.("src-1", 1, neutral);
    expectChain.("src-2", 2, neutral);
    expectChain.("src-3", 5, neutral);
    sourcesTree = query.(~mxSourcesGroup.nodeID);
    check.(sourcesTree[\children].collect { |c| c[\id] }.asArray
      == ["src-1", "src-2", "src-3"].collect { |id| ~mxSources[id][\group].nodeID }, "groupes de sources inattendus");

    // Changements de modèle : la position de l'étage reste la même.
    ~mxSetSourceStage.("src-1", \eq, (low: 0.7, mid: 0.5, high: 0.5));
    server.sync;
    expectChain.("src-1", 1, [\in, \eq, \hp, \lp, \pitch, \dyn, \mix]);
    ~mxSetSourceStage.("src-1", \eq, (low: 0.5, mid: 0.5, high: 0.5));
    ~mxSetSourceStage.("src-1", \hp, (enabled: 1, model: \BHiPass4, freq: 0.2, q: 1, mul: 1, add: 0));
    ~mxSetSourceStage.("src-1", \lp, (enabled: 1, model: \MoogFF, freq: 0.8, q: 1, gain: 2, mul: 1, add: 0));
    server.sync;
    expectChain.("src-1", 1, [\in, \eqdirect, \hp4, \lpmoog, \pitch, \dyn, \mix]);
    ~mxResetMoog.("src-1");
    ~mxSetSourceStage.("src-1", \hp, (enabled: 1, model: \RHPF, freq: 0.2, q: 1, mul: 1, add: 0));
    ~mxSetSourceStage.("src-1", \lp, (enabled: 0, model: \BLowPass4, freq: 1, q: 1, gain: 2, mul: 1, add: 0));
    server.sync;
    expectChain.("src-1", 1, [\in, \eqdirect, \hp, \lp4, \pitch, \dyn, \mix]);
    raised = false;
    try { ~mxResetMoog.("src-1") } { raised = true };
    check.(raised, "~mxResetMoog accepté hors MoogFF");

    ~mxSetSourceStage.("src-3", \mix, (volume: 0.8, cue: 0.5, mute: 1, balance: 0.25));
    ~mxSetSourceStage.("src-3", \input, (gain: 0.5));
    ~mxSetSourceStage.("src-3", \inputCompressor, (thresholdDb: -30, ratio: 8, attackMs: 5, releaseMs: 200, makeupDb: 3, bypass: 0));
    ~mxSetSourceStage.("src-3", \pitch, (semitones: 3));
    ~mxSetSourceStage.("src-3", \bandCompressor, (band: \mid, thresholdDb: -30, ratio: 8, attackMs: 5, releaseMs: 200, makeupDb: 3, bypass: 0));
    server.sync;
    expectChain.("src-3", 5, neutral);

    // Compresseur de sortie : bascule de modèle avec fondu.
    ~mxSetOutputStage.(\master, \compressor, (model: \CompanderD, thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25,
      attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: 0));
    ~mxSetOutputStage.(\cue, \compressor, (model: \FaustRMS, thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25,
      attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: 0));
    1.wait;
    outputDefs = query.(~mxOutputGroup.nodeID)[\children].collect { |c| c[\def] }.asArray.sort;
    check.(outputDefs == ["mx_output_companderD", "mx_output_faustRMS", "mx_output_writer", "mx_output_writer"],
      "bascule de compresseur inattendue " ++ outputDefs);
    ~mxSetOutputStage.(\cue, \eq, (low: 0.6, mid: 0.5, high: 0.4));
    ~mxSetOutputStage.(\cue, \infraHpf, (enabled: 1, hz: 30));
    ~mxSetOutputStage.(\cue, \sideHpf, (enabled: 1, hz: 120));
    ~mxSetOutputStage.(\cue, \clipper, (enabled: 1, ceilingDb: -1));
    ~mxSetOutputStage.(\cue, \limiter, (enabled: 1, ceilingDb: -2));

    // Review Focus 5 : changer la largeur de src-2 laisse src-1 et src-3 intacts.
    ids1 = ~mxNodeIds.("src-1");
    ids3 = ~mxNodeIds.("src-3");
    check.(~mxEnsureWidth.(3), "~mxEnsureWidth(3) ne construit pas");
    ~mxRemoveSource.("src-2");
    ~mxAddSource.("src-2", 2, 2, 1, defaultProc.());
    server.sync;
    check.(~mxNodeIds.("src-1") == ids1, "src-1 : ID modifiés par le changement de largeur de src-2");
    check.(~mxNodeIds.("src-3") == ids3, "src-3 : ID modifiés par le changement de largeur de src-2");
    check.(sourceTree.("src-1")[\children].collect { |c| c[\id] }.asArray == ids1, "src-1 : nœuds absents du serveur");
    check.(sourceTree.("src-3")[\children].collect { |c| c[\id] }.asArray == ids3, "src-3 : nœuds absents du serveur");
    expectChain.("src-2", 1, neutral);

    // Retrait : le groupe disparaît du serveur.
    removedGroup = ~mxSources["src-3"][\group].nodeID;
    ~mxRemoveSource.("src-3");
    server.sync;
    sourcesTree = query.(~mxSourcesGroup.nodeID);
    check.(sourcesTree[\children].collect { |c| c[\id] }.includes(removedGroup).not, "groupe de src-3 toujours présent");
    check.(sourcesTree[\children].size == 2, "nombre de groupes de sources inattendu");
    raised = false;
    try { ~mxNodeIds.("src-3") } { raised = true };
    check.(raised, "~mxNodeIds accepte une source retirée");

    // Réservation d'id : deux ajouts concurrents du même id, largeur 7 pas encore construite.
    groupsBefore = query.(~mxSourcesGroup.nodeID)[\children].size;
    errors = List.new;
    tasks = 2.collect { |n|
      Routine({
        try { ~mxAddSource.("src-race", 9, 1, 7, defaultProc.()) } { |error| errors.add(error.errorString) };
      }).play(SystemClock)
    };
    0.02.wait;
    // Pendant la construction, l'id est réservé : retrait et réglage échouent explicitement.
    raised = false;
    try { ~mxRemoveSource.("src-race") } { |error| raised = error.errorString.find("en cours de création").notNil };
    check.(raised, "~mxRemoveSource accepté sur une source en cours de création");
    raised = false;
    try { ~mxSetSourceStage.("src-race", \pitch, (semitones: 1)) } { |error| raised = error.errorString.find("en cours de création").notNil };
    check.(raised, "~mxSetSourceStage accepté sur une source en cours de création");
    while { ~mxSources["src-race"].notNil and: { ~mxSources["src-race"][\pending] == true } } { 0.05.wait };
    server.sync;
    check.(errors.size == 1, "deuxième ~mxAddSource concurrent : " ++ errors.size ++ " erreur(s) au lieu de 1");
    check.(errors[0].find("en cours de création").notNil, "erreur inattendue " ++ errors[0]);
    groupsAfter = query.(~mxSourcesGroup.nodeID)[\children].size;
    check.(groupsAfter == (groupsBefore + 1), "groupes de src-race : " ++ (groupsAfter - groupsBefore) ++ " au lieu de 1");
    expectChain.("src-race", 7, neutral);
    ~mxRemoveSource.("src-race");

    // Canaux au-delà de la borne d'entrée : refus explicite, sans réservation résiduelle.
    raised = false;
    try { ~mxAddSource.("src-wide", 10, 250, 10, defaultProc.()) } { |error| raised = error.errorString.find("au-delà").notNil };
    check.(raised, "~mxAddSource accepte des canaux au-delà des entrées");
    check.(~mxSources["src-wide"].isNil, "réservation résiduelle après refus");

    finish.("MX-TEST-OK");
  } { |error|
    fail.(error.errorString);
  };
}, onFailure: { fail.("démarrage du serveur impossible") });
)
