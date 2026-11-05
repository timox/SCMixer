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
 *
 * ~mxFixture (traitement par défaut et étages de sortie par défaut, en noms de contrôles) est produit
 * à partir du contrat par tests/sc-integration.test.js : ce fichier n'a aucune valeur par défaut propre.
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var server = Server(\mxtest, NetAddr("127.0.0.1", 57140));
var done = false;
var finish, fail, check, query, parse, sourceTree, expectChain, defaultProc, outStage, with, getControl;

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

defaultProc = { ~mxFixture[\proc] };
with = { |event, pairs| var copy = event.copy; pairs.pairsDo { |key, value| copy[key] = value }; copy };
outStage = { |stage, pairs| with.(~mxFixture[\outputs][stage], pairs ? []) };
// Valeur d'un contrôle lue sur le serveur (/s_get), avec délai : prouve que le nom du contrat arrive à scsynth.
getControl = { |node, name|
  var value, cond = Condition.new;
  node.get(name, { |v| value = v; cond.test = true; cond.signal });
  SystemClock.sched(3, { cond.test = true; cond.signal; nil });
  cond.wait;
  check.(value.notNil, "pas de réponse /s_get pour " ++ name);
  value
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

// Jeton normalement posé par engine.scd (SYNTHDEF_TIMEOUT_SECONDS).
~mxSynthDefTimeout = 5;
(root +/+ "sc" +/+ "graph.scd").load;

server.waitForBoot({
  try {
    var neutral = [\in, \eqdirect, \hpBHiPass, \lpBLowPass, \pitch, \dyn, \mix];
    var errors, tasks, groupsBefore, groupsAfter, defaultTree, sourcesTree, outputTree, outputDefs, ids1, ids3, removedGroup, raised, delays, node, oldPitch;
    ("MX-TEST-SCSYNTH-PID " ++ server.pid).postln;

    ~mxInit.(server, 256);
    check.(~mxModels == (Compander: true, CompanderD: true, FaustRMS: true), "modèles de compresseur " ++ ~mxModels);
    ~mxSetOutputStage.(\master, \mix, outStage.(\mix, [\mixVolume, 0]));
    ~mxSetOutputStage.(\cue, \mix, outStage.(\mix, [\mixVolume, 0]));

    // Bus : le premier bus privé alloué est celui des options (contrat : 260 avec 256 entrées et 4 sorties).
    check.(~mxMasterBus.index == server.options.firstPrivateBus, "premier bus privé " ++ ~mxMasterBus.index);
    check.(~mxCueBus.index == (~mxMasterBus.index + 2), "bus cue " ++ ~mxCueBus.index);
    // ~mxInit n'est pas ré-exécutable (groupes et bus dupliqués).
    raised = false;
    try { ~mxInit.(server, 256) } { |error| raised = error.errorString.find("déjà exécuté").notNil };
    check.(raised, "~mxInit ré-exécuté sans erreur");
    // CompanderD : maxdelaytime du DelayN fixé à la plage d'attaque maximale (0.1 s), pas à l'argument d'attaque.
    delays = SynthDescLib.global[\mx_output_companderD].def.children.select { |u| u.class == DelayN };
    check.(delays.size == 2, "DelayN du modèle CompanderD : " ++ delays.size);
    delays.do { |u| check.(u.inputs[1].isNumber and: { u.inputs[1] == ~mxCompanderDMaxDelay }, "maxdelaytime de DelayN : " ++ u.inputs[1]) };
    // Marge du fondu : plancher à la période de test (hardwareBufferSize non posé), 8 périodes au-delà.
    check.(~mxFadeMargin.(server) == ~mxFadeMarginFloorSeconds, "marge de fondu au plancher : " ++ ~mxFadeMargin.(server));
    check.((~mxFadeMargin.((options: (hardwareBufferSize: 2048), sampleRate: 48000)) - (8 * 2048 / 48000)).abs < 1e-9,
      "marge de fondu à 2048 images : " ++ ~mxFadeMargin.((options: (hardwareBufferSize: 2048), sampleRate: 48000)));
    check.(~mxFadeMargin.((options: (hardwareBufferSize: 256), sampleRate: 48000)) == ~mxFadeMarginFloorSeconds, "plancher à 256 images");
    // Fondu de retrait : au moins une période matérielle, jamais sous ~mxFadeSeconds.
    check.(~mxRemoveRamp.(server) == ~mxFadeSeconds, "fondu de retrait au plancher : " ++ ~mxRemoveRamp.(server));
    check.((~mxRemoveRamp.((options: (hardwareBufferSize: 4096), sampleRate: 48000)) - (2 * 4096 / 48000)).abs < 1e-9, "fondu de retrait à 4096 images");
    check.(~mxRemoveRamp.((options: (hardwareBufferSize: 256), sampleRate: 48000)) >= (256 / 48000), "fondu de retrait inférieur à une période");

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
    ~mxSetSourceStage.("src-1", \eq, with.(defaultProc.()[\eq], [\low, 0.7]));
    server.sync;
    expectChain.("src-1", 1, [\in, \eq, \hpBHiPass, \lpBLowPass, \pitch, \dyn, \mix]);
    // Les contrôles du contrat arrivent au serveur sous leur nom (/s_get), conversions faites dans la SynthDef.
    ~mxSetSourceStage.("src-1", \eq, with.(defaultProc.()[\eq], [\low, 0.7, \lowFreq, 150, \midRq, 0.4]));
    server.sync;
    node = ~mxSources["src-1"][\nodes];
    check.((getControl.(node[\eq], \lowFreq) - 150).abs < 1e-6, "lowFreq de l'EQ");
    check.((getControl.(node[\eq], \midRq) - 0.4).abs < 1e-6, "midRq de l'EQ");
    ~mxSetSourceStage.("src-1", \eq, defaultProc.()[\eq]);
    ~mxSetSourceStage.("src-1", \hp, with.(defaultProc.()[\hp], [\enabled, 1, \model, \BHiPass4, \freq, 0.2]));
    ~mxSetSourceStage.("src-1", \lp, with.(defaultProc.()[\lp], [\enabled, 1, \model, \MoogFF, \freq, 0.8]));
    server.sync;
    expectChain.("src-1", 1, [\in, \eqdirect, \hpBHiPass4, \lpMoogFF, \pitch, \dyn, \mix]);
    ~mxResetMoog.("src-1");
    ~mxSetSourceStage.("src-1", \hp, with.(defaultProc.()[\hp], [\enabled, 1, \model, \RHPF, \freq, 0.2, \floorHz, 55]));
    ~mxSetSourceStage.("src-1", \lp, with.(defaultProc.()[\lp], [\enabled, 0, \model, \BLowPass4]));
    server.sync;
    expectChain.("src-1", 1, [\in, \eqdirect, \hpRHPF, \lpBLowPass4, \pitch, \dyn, \mix]);
    node = ~mxSources["src-1"][\nodes];
    check.((getControl.(node[\hp], \floorHz) - 55).abs < 1e-6, "floorHz de RHPF");
    // Un champ non applicable au modèle chargé (gain hors MoogFF) est ignoré ; un contrôle inconnu lève.
    ~mxSetSourceStage.("src-1", \lp, with.(defaultProc.()[\lp], [\model, \BLowPass4, \gain, 3]));
    raised = false;
    try { ~mxSetSourceStage.("src-1", \pitch, with.(defaultProc.()[\pitch], [\nope, 1])) } { |error| raised = error.errorString.find("Contrôle inconnu").notNil };
    check.(raised, "contrôle inconnu accepté");
    raised = false;
    try { ~mxResetMoog.("src-1") } { raised = true };
    check.(raised, "~mxResetMoog accepté hors MoogFF");

    ~mxSetSourceStage.("src-3", \mix, with.(defaultProc.()[\mix], [\volume, 0.8, \cue, 0.5, \mute, 1, \balance, 0.25, \splayLevel, 0.9, \spread, 0.6]));
    ~mxSetSourceStage.("src-3", \input, with.(defaultProc.()[\input], [\inputGain, 0.5]));
    ~mxSetSourceStage.("src-3", \inputCompressor, with.(defaultProc.()[\inputCompressor],
      [\inputCompressorThresholdDb, -30, \inputCompressorSlopeBelow, 1.5, \inputCompressorSlopeAbove, 0.125,
        \inputCompressorAttackMs, 5, \inputCompressorReleaseMs, 200, \inputCompressorMul, 2, \inputCompressorBypass, 0]));
    ~mxSetSourceStage.("src-3", \bandCompressor, with.(defaultProc.()[\bandCompressor][\mid],
      [\band, \mid, \midThresholdDb, -30, \midSlopeAbove, 0.125, \midBypass, 0]));
    ~mxSetSourceStage.("src-3", \bandCompressor, with.(defaultProc.()[\bandCompressor][\crossover], [\band, \crossover, \crossoverLowMidFreq, 300]));
    server.sync;
    node = ~mxSources["src-3"][\nodes];
    check.((getControl.(node[\input], \inputCompressorSlopeBelow) - 1.5).abs < 1e-6, "inputCompressorSlopeBelow");
    check.((getControl.(node[\dyn], \midThresholdDb) + 30).abs < 1e-6, "midThresholdDb");
    check.((getControl.(node[\dyn], \crossoverLowMidFreq) - 300).abs < 1e-6, "crossoverLowMidFreq");
    check.((getControl.(node[\mix], \splayLevel) - 0.9).abs < 1e-6, "splayLevel");
    raised = false;
    try { ~mxSetSourceStage.("src-3", \bandCompressor, with.(defaultProc.()[\bandCompressor][\mid], [\band, \top])) } { raised = true };
    check.(raised, "bande inconnue acceptée");
    // windowSize de PitchShift est fixé à la création du UGen : le changer recrée le Synth à sa place.
    oldPitch = ~mxNodeIds.("src-3")[4];
    ~mxSetSourceStage.("src-3", \pitch, with.(defaultProc.()[\pitch], [\semitones, 3, \blend, 1]));
    server.sync;
    check.(~mxNodeIds.("src-3")[4] == oldPitch, "pitch recréé sans changement de windowSize");
    ~mxSetSourceStage.("src-3", \pitch, with.(defaultProc.()[\pitch], [\semitones, 3, \blend, 1, \windowSize, 0.1]));
    server.sync;
    check.(~mxNodeIds.("src-3")[4] != oldPitch, "pitch non recréé après changement de windowSize");
    expectChain.("src-3", 5, neutral);
    check.((getControl.(~mxSources["src-3"][\nodes][\pitch], \windowSize) - 0.1).abs < 1e-6, "windowSize");

    // Compresseur de sortie : bascule de modèle avec fondu.
    ~mxSetOutputStage.(\master, \compressor, outStage.(\compressor, [\model, \CompanderD, \compressorBypass, 0]));
    ~mxSetOutputStage.(\cue, \compressor, outStage.(\compressor, [\model, \FaustRMS, \compressorBypass, 0]));
    1.wait;
    outputDefs = query.(~mxOutputGroup.nodeID)[\children].collect { |c| c[\def] }.asArray.sort;
    check.(outputDefs == ["mx_output_companderD", "mx_output_faustRMS", "mx_output_writer", "mx_output_writer"],
      "bascule de compresseur inattendue " ++ outputDefs);
    // Une attaque de 100 ms après la création du Synth reste valide pour CompanderD.
    ~mxSetOutputStage.(\master, \compressor, outStage.(\compressor, [\model, \CompanderD, \compressorAttackMs, 100, \compressorBypass, 0]));
    ~mxSetOutputStage.(\cue, \eq, outStage.(\eq, [\eqLow, 0.6, \eqHigh, 0.4, \eqLowFreq, 150, \eqMidRq, 0.5]));
    ~mxSetOutputStage.(\cue, \infraHpf, outStage.(\infraHpf, [\infraHpfEnabled, 1, \infraHpfHz, 30]));
    ~mxSetOutputStage.(\cue, \sideHpf, outStage.(\sideHpf, [\sideHpfEnabled, 1, \sideHpfHz, 120]));
    ~mxSetOutputStage.(\cue, \clipper, outStage.(\clipper, [\clipperEnabled, 1, \clipperLo, -0.8, \clipperHi, 0.9]));
    ~mxSetOutputStage.(\cue, \limiter, outStage.(\limiter, [\limiterEnabled, 1, \limiterCeilingDb, -2]));
    server.sync;
    node = ~mxOutputs[\cue][\synth];
    check.((getControl.(node, \eqLowFreq) - 150).abs < 1e-6, "eqLowFreq de sortie");
    check.((getControl.(node, \clipperLo) + 0.8).abs < 1e-6, "clipperLo");
    check.((getControl.(node, \limiterCeilingDb) + 2).abs < 1e-6, "limiterCeilingDb");
    check.(getControl.(node, \infraHpfHz) == 30, "infraHpfHz");
    // compressor.fadeSeconds pilote l'écrivain (VarLag du fondu), pas le processeur.
    ~mxSetOutputStage.(\cue, \compressor, outStage.(\compressor, [\model, \FaustRMS, \compressorBypass, 0, \compressorFadeSeconds, 0.2]));
    server.sync;
    check.((getControl.(~mxOutputs[\cue][\writer], \compressorFadeSeconds) - 0.2).abs < 1e-6, "compressorFadeSeconds de l'écrivain");
    // dur du Limiter est fixé à la création du UGen : le changer bascule vers un nouveau processeur avec fondu.
    ~mxSetOutputStage.(\cue, \limiter, outStage.(\limiter, [\limiterEnabled, 1, \limiterCeilingDb, -2, \limiterDurMs, 20]));
    check.(~mxOutputs[\cue][\phase] == \warming, "changement de dur sans bascule : " ++ ~mxOutputs[\cue][\phase]);
    raised = false;
    try { ~mxSetOutputStage.(\cue, \limiter, outStage.(\limiter, [\limiterDurMs, 30])) } { |error| raised = error.errorString.find("en cours").notNil };
    check.(raised, "bascule concurrente acceptée");
    1.2.wait;
    check.(~mxOutputs[\cue][\phase] == \stable, "bascule non terminée : " ++ ~mxOutputs[\cue][\phase]);
    check.(getControl.(~mxOutputs[\cue][\synth], \limiterDurMs) == 20, "limiterDurMs du nouveau processeur");
    check.(getControl.(~mxOutputs[\cue][\synth], \eqLowFreq) == 150, "les réglages précédents suivent la bascule");

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

    // Retrait : fondu à zéro d'abord (le groupe existe encore), puis libération différée.
    removedGroup = ~mxSources["src-3"][\group].nodeID;
    node = ~mxSources["src-3"][\nodes][\mix];
    ~mxRemoveSource.("src-3");
    server.sync;
    check.(query.(~mxSourcesGroup.nodeID)[\children].collect { |c| c[\id] }.includes(removedGroup), "groupe de src-3 libéré sans fondu");
    check.(getControl.(node, \fadeGate) == 0, "fadeGate non ramené à zéro");
    check.((getControl.(node, \fadeSeconds) - ~mxRemoveRamp.(server)).abs < 1e-6, "durée du fondu de retrait");
    raised = false;
    try { ~mxNodeIds.("src-3") } { raised = true };
    check.(raised, "~mxNodeIds accepte une source retirée");
    (~mxRemoveRamp.(server) + ~mxFadeMargin.(server) + 0.4).wait;
    sourcesTree = query.(~mxSourcesGroup.nodeID);
    check.(sourcesTree[\children].collect { |c| c[\id] }.includes(removedGroup).not, "groupe de src-3 toujours présent");
    check.(sourcesTree[\children].size == 2, "nombre de groupes de sources inattendu");

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
    try { ~mxSetSourceStage.("src-race", \pitch, with.(defaultProc.()[\pitch], [\semitones, 1])) } { |error| raised = error.errorString.find("en cours de création").notNil };
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
