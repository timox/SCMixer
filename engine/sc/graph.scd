/*
 * Graphe du moteur : groupes, bus, SynthDefs de sortie et fonctions ~mx*.
 *
 * Découpage des scripts :
 *   - engine.scd       options du serveur (jetons substitués par le lanceur),
 *                      démarrage, puis ~mxInit.(s) ;
 *   - graph.scd        ce fichier : aucune valeur de configuration, le serveur
 *                      est passé à ~mxInit ; il est donc chargeable tel quel par
 *                      les tests contre leur propre serveur ;
 *   - source-defs.scd  ~mxEnsureWidth : SynthDefs de source par largeur.
 *
 * Toutes les fonctions qui créent des nœuds ou des SynthDefs (~mxInit,
 * ~mxEnsureWidth, ~mxAddSource) appellent server.sync : les appeler depuis une
 * Routine. Les autres fonctions envoient leurs messages sans attente.
 *
 * Création en cours : ~mxAddSource réserve l'identifiant (marqueur `pending`)
 * avant toute attente. Pendant la réservation, un second ~mxAddSource du même
 * id, ~mxRemoveSource, ~mxSetSourceStage, ~mxResetMoog et ~mxNodeIds lèvent
 * une erreur explicite (pas d'attente). Si la création échoue, la réservation
 * est libérée et l'erreur est relancée.
 *
 * Fonctions produites (arguments dans l'ordre) :
 *   ~mxInit.(server, inputChannels)             -> inputChannels : borne de
 *                                                 firstChannel + width - 1 (défaut :
 *                                                 server.options.numInputBusChannels)
 *   ~mxEnsureWidth.(width)                      -> true si construite, false si déjà présente
 *   ~mxAddSource.(id, meterId, firstChannel, width, proc)   -> ~mxNodeIds.(id)
 *   ~mxRemoveSource.(id)
 *   ~mxSetSourceStage.(id, stage, values)
 *   ~mxSetOutputStage.(output, stage, values)
 *   ~mxResetMoog.(id)
 *   ~mxNodeIds.(id)                             -> ID des 7 Synths, dans l'ordre de la chaîne
 *
 * `proc` et `values` reprennent les noms de champs JSON du contrat ; booléens
 * en 0/1, modèles en symboles. Étages de source : \mix \input \inputCompressor
 * \eq \hp \lp \pitch \bandCompressor ; pour \bandCompressor, `values` est une
 * CompBand complétée de `band` (\low, \mid ou \high). Étages de sortie : \mix
 * \eq \infraHpf \sideHpf \clipper \limiter \compressor ; sorties \master \cue.
 *
 * Vumètres (SendPeakRMS) : '/mx/source-meter' avec le meterId de la source,
 * un couple crête/RMS par canal ; '/mx/output-meter' avec les ID 0/1 (Master
 * gauche/droite) et 2/3 (Cue gauche/droite).
 */

(thisProcess.nowExecutingPath.dirname +/+ "source-defs.scd").load;

~mxControlLag = 0.05;
// Délai maximal du DelayN du modèle CompanderD : maximum de la plage d'attaque du contrat
// (attackMs 1..100, soit 0.1 s). Constante de SynthDef : la taille du tampon est fixée à la
// création (DelayN.schelp : maxdelaytime « used to initialize the delay buffer size »).
~mxCompanderDMaxDelay = 0.1;
// Fondu du compresseur de sortie : durée du VarLag de l'écrivain, puis marge avant de libérer
// l'ancien Synth (Server-Command-Reference /n_free : un nœud non silencieux libéré peut cliquer).
~mxFadeSeconds = 0.05;
~mxFadeMarginSeconds = 0.25;
~mxInitDone = false;
~mxHpModels = (BHiPass: 0, RHPF: 1, BHiPass4: 2);
~mxLpModels = (BLowPass: 0, RLPF: 1, BLowPass4: 2, MoogFF: 3);
~mxCompressorDefs = (Compander: \mx_output_compander, CompanderD: \mx_output_companderD,
  FaustRMS: \mx_output_faustRMS);

// Valeurs d'un Event dans l'ordre des clés ; un champ absent est une erreur.
~mxRequire = { |values, keys|
  if(values.isKindOf(Dictionary).not) { Error("Valeurs attendues sous forme d'Event").throw };
  keys.collect { |key|
    var value = values[key];
    if(value.isNil) { Error("Champ manquant : " ++ key).throw };
    value
  }
};

// === SORTIES (filtres infra et latéral, EQ, volume, écrêteur, limiteur, compresseur) ===
~mxOutputDef = { |name, compress|
  SynthDef(name, {
    |in, out, volume=1, eqLow=0.5, eqMid=0.5, eqHigh=0.5, controlLag=0.05,
     infraHpfEnabled=0, infraHpfHz=25, sideHpfEnabled=0, sideHpfHz=100,
     clipEnabled=0, clipCeilingDb=0, limitEnabled=0, limitCeilingDb=(-1),
     compThresholdDb=(-20), compSlopeBelow=1, compSlopeAbove=0.25,
     compAttackMs=10, compReleaseMs=100, compMul=1, compAdd=0, compBypass=1|
    var sig = In.ar(in, 2);
    var eqMix = (((eqLow - 0.5).abs + (eqMid - 0.5).abs + (eqHigh - 0.5).abs) > 0.0001).lag(controlLag);
    var lowDb = (eqLow.lag(controlLag) * 2 - 1) * 12;
    var midDb = (eqMid.lag(controlLag) * 2 - 1) * 12;
    var highDb = (eqHigh.lag(controlLag) * 2 - 1) * 12;
    var dry, mid, side, clipLevel, limited, compressed;

    sig = sig + ((HPF.ar(sig, infraHpfHz.lag(controlLag)) - sig) * infraHpfEnabled.lag(controlLag));
    mid = (sig[0] + sig[1]) * 0.5;
    side = (sig[0] - sig[1]) * 0.5;
    side = side + ((HPF.ar(side, sideHpfHz.lag(controlLag)) - side) * sideHpfEnabled.lag(controlLag));
    sig = [mid + side, mid - side];
    dry = sig;

    sig = BLowShelf.ar(sig, 200, 0.5, lowDb);
    sig = BPeakEQ.ar(sig, 1000, 0.7, midDb);
    sig = BHiShelf.ar(sig, 8000, 0.5, highDb);
    sig = dry + ((sig - dry) * eqMix);

    // Le volume précède le compresseur final.
    sig = sig * volume.lag(controlLag);

    clipLevel = clipCeilingDb.dbamp;
    sig = sig + ((Clip.ar(sig, clipLevel.neg, clipLevel) - sig) * clipEnabled.lag(controlLag));
    limited = Limiter.ar(sig, limitCeilingDb.dbamp, 0.01);
    sig = sig + ((limited - sig) * limitEnabled.lag(controlLag));

    // Le compresseur est le dernier traitement audio.
    compressed = compress.(sig, compThresholdDb, compSlopeBelow, compSlopeAbove,
      compAttackMs, compReleaseMs, compMul, compAdd);
    sig = Select.ar(compBypass, [compressed, sig]);

    Out.ar(out, sig);
  })
};

// Seul écrivain matériel de chaque sortie ; les processeurs écrivent sur deux bus privés.
~mxOutputWriterDef = SynthDef(\mx_output_writer, { |inA, inB, out, mix=0, fadeSeconds=0.05, meterId=0|
  var blend = VarLag.kr(mix, fadeSeconds, warp: \linear);
  var sig = (In.ar(inA, 2) * (1 - blend)) + (In.ar(inB, 2) * blend);
  SendPeakRMS.kr(sig[0], 10, 0.25, '/mx/output-meter', meterId);
  SendPeakRMS.kr(sig[1], 10, 0.25, '/mx/output-meter', meterId + 1);
  Out.ar(out, sig);
});

// === BANCS DE MESURE (bus privés uniquement, sauf \mx_lab_monitor) ===
~mxBenchDefs = {
  [
    // Signal de mesure du compresseur multibande ; jamais relié à Master ou Cue.
    SynthDef(\mx_bench_dynamics_source, { |out|
      var mono = Mix(SinOsc.ar([100, 1000, 8000], 0, 0.25));
      Out.ar(out, [mono, mono]);
    }),
    SynthDef(\mx_bench_dynamics_meter, { |in, caseId=0|
      var stereo = In.ar(in, 2);
      var monoRms = ((stereo[0].squared + stereo[1].squared) * 0.5).sqrt;
      SendPeakRMS.kr(monoRms, 1, 0.25, '/mx/dynamics-bench', caseId);
    }),
    SynthDef(\mx_eqlab_noise, { |out, amp=0.2|
      Out.ar(out, PinkNoise.ar(amp ! 2));
    }),
    // Reproduit l'ancien empilement de multiplicateurs scalaires source + sortie.
    SynthDef(\mx_eqlab_legacy, { |in, out, low=0.5, mid=0.5, high=0.5|
      var sig = In.ar(in, 2);
      var gain = low.lag(0.05).linlin(0, 1, 0.5, 2.0)
        * mid.lag(0.05).linlin(0, 1, 0.5, 2.0)
        * high.lag(0.05).linlin(0, 1, 0.5, 2.0);
      ReplaceOut.ar(out, sig * gain * gain);
    }),
    // Plateau grave, cloche médium, plateau aigu, répétés pour source + sortie.
    SynthDef(\mx_eqlab_threeband, { |in, out, low=0.5, mid=0.5, high=0.5|
      var sig = In.ar(in, 2);
      var lowDb = (low.lag(0.05) * 2 - 1) * 12;
      var midDb = (mid.lag(0.05) * 2 - 1) * 12;
      var highDb = (high.lag(0.05) * 2 - 1) * 12;
      2.do {
        sig = BLowShelf.ar(sig, 80, 0.5, lowDb);
        sig = BPeakEQ.ar(sig, 1000, 0.7, midDb);
        sig = BHiShelf.ar(sig, 8000, 0.5, highDb);
      };
      ReplaceOut.ar(out, sig);
    }),
    // Seul écrivain matériel direct, réservé au banc EQ démarré explicitement.
    SynthDef(\mx_lab_monitor, { |in, out|
      ReplaceOut.ar(out, In.ar(in, 2));
    })
  ]
};

// Sonde côté serveur d'un UGen : ajoute un SynthDef puis vérifie son chargement par ~mxSynthDefLoaded
// (source-defs.scd). /d_recv échoue côté scsynth si un UGen (plug-in) n'est pas chargé, sans /fail :
// Server-Architecture (les plug-ins sont chargés par scsynth), Server-Command-Reference (/d_recv, /s_new).
// À appeler depuis une Routine.
~mxProbeSynthDef = { |server, name, graphFunc|
  var found;
  SynthDef(name, graphFunc).add;
  server.sync;
  found = ~mxSynthDefLoaded.(server, name);
  server.sendMsg('/d_free', name);
  server.sync;
  found
};

~mxInit = { |server, inputChannels|
  var models, faustLoaded;
  if(~mxInitDone == true) { Error("~mxInit déjà exécuté : groupes et bus déjà créés").throw };
  // Contrat de bus : sorties matérielles 0..3 (master 0/1, cue 2/3), entrées 4..259, premier bus
  // privé 260 (ServerOptions : les entrées suivent les sorties ; numAudioBusChannels les inclut).
  if(server.serverRunning.not) { Error("~mxInit : serveur non démarré").throw };
  if(server.options.numOutputBusChannels != 4) { Error("~mxInit : 4 sorties matérielles attendues").throw };
  if(server.options.firstPrivateBus != (server.options.numInputBusChannels + server.options.numOutputBusChannels)) {
    Error("~mxInit : premier bus privé incohérent : " ++ server.options.firstPrivateBus).throw;
  };
  // Allocateur reconstruit au boot et encore vierge : aucun Bus.audio n'a été alloué avant.
  if(server.audioBusAllocator.top != server.options.firstPrivateBus) {
    Error("~mxInit : allocateur de bus audio non vierge (top=" ++ server.audioBusAllocator.top ++ ")").throw;
  };
  ~mxServer = server;
  // Borne des canaux d'entrée acceptés par ~mxAddSource ; par défaut, les entrées du serveur.
  ~mxInputChannels = inputChannels ?? { server.options.numInputBusChannels };
  ~mxSources = Dictionary.new;
  ~mxBuiltWidths = Set.new;

  // Disponibilité des modèles de compresseur de sortie. Compander et DelayN sont des UGens du
  // jeu standard de scsynth : Compander et CompanderD (construit ici avec un DelayN à délai maximal fixe)
  // sont toujours disponibles. FaustRMS exige la classe sclang ET le chargement effectif du plug-in
  // .scx par scsynth, vérifié par une sonde côté serveur.
  faustLoaded = \MixetteFaustRMS.asClass.notNil and: {
    ~mxProbeSynthDef.(server, \mx_probe_faustRMS, {
      \MixetteFaustRMS.asClass.ar(DC.ar(0), DC.ar(0), -20, 1, 0.25, 10, 100)
    })
  };
  models = (Compander: true, CompanderD: true, FaustRMS: faustLoaded);
  ~mxModels = models;

  ~mxOutputDef.(\mx_output_compander, { |sig, threshold, below, above, attack, release, mul, add|
    Compander.ar(sig, sig, threshold.dbamp, below, above, attack / 1000, release / 1000, mul, add)
  }).add;
  // Équivalent de CompanderD.ar (Compander.sc : DelayN.ar(in, clampTime, clampTime) en entrée de traitement,
  // signal direct en contrôle) mais avec un maxdelaytime fixe (~mxCompanderDMaxDelay) : une attaque
  // modifiée après la création du Synth reste valide.
  ~mxOutputDef.(\mx_output_companderD, { |sig, threshold, below, above, attack, release, mul, add|
    Compander.ar(DelayN.ar(sig, ~mxCompanderDMaxDelay, (attack / 1000).min(~mxCompanderDMaxDelay)), sig,
      threshold.dbamp, below, above, attack / 1000, release / 1000).madd(mul, add)
  }).add;
  if(models[\FaustRMS]) {
    ~mxOutputDef.(\mx_output_faustRMS, { |sig, threshold, below, above, attack, release, mul, add|
      \MixetteFaustRMS.asClass.ar(sig[0], sig[1], threshold, below, above, attack, release) * mul + add
    }).add;
  };
  ~mxOutputWriterDef.add;
  ~mxBenchDefs.().do { |def| def.add };
  server.sync;

  // Ordre d'exécution : sources, bancs, sorties.
  ~mxSourcesGroup = Group.head(server.defaultGroup);
  ~mxBenchGroup = Group.after(~mxSourcesGroup);
  ~mxOutputGroup = Group.after(~mxBenchGroup);
  ~mxMasterBus = Bus.audio(server, 2);
  ~mxCueBus = Bus.audio(server, 2);
  if(~mxMasterBus.index != server.options.firstPrivateBus) {
    Error("~mxInit : le premier bus privé devrait être " ++ server.options.firstPrivateBus
      ++ ", obtenu " ++ ~mxMasterBus.index).throw;
  };

  ~mxOutputs = IdentityDictionary.new;
  [\master, \cue].do { |name, index|
    var slots = Array.fill(2, { Bus.audio(server, 2) });
    var params = (in: if(name == \master) { ~mxMasterBus.index } { ~mxCueBus.index },
      out: slots[0].index, volume: 1, eqLow: 0.5, eqMid: 0.5, eqHigh: 0.5, controlLag: ~mxControlLag,
      infraHpfEnabled: 0, infraHpfHz: 25, sideHpfEnabled: 0, sideHpfHz: 100,
      clipEnabled: 0, clipCeilingDb: 0, limitEnabled: 0, limitCeilingDb: -1,
      compThresholdDb: -20, compSlopeBelow: 1, compSlopeAbove: 0.25, compAttackMs: 10,
      compReleaseMs: 100, compMul: 1, compAdd: 0, compBypass: 1);
    ~mxOutputs[name] = (name: name, slots: slots, slot: 0, params: params, model: \Compander,
      synth: Synth.tail(~mxOutputGroup, \mx_output_compander, params.asKeyValuePairs),
      phase: \stable, old: nil, routine: nil);
  };
  // Master vers les sorties matérielles 0/1, Cue vers 2/3.
  [\master, \cue].do { |name, index|
    var output = ~mxOutputs[name];
    output[\writer] = Synth.tail(~mxOutputGroup, \mx_output_writer, [
      \inA, output[\slots][0].index, \inB, output[\slots][1].index,
      \out, index * 2, \meterId, index * 2, \fadeSeconds, ~mxFadeSeconds]);
  };
  server.sync;
  ~mxInitDone = true;
  true
};

// === SOURCES ===

~mxSource = { |id|
  var source = ~mxSources[id];
  if(source.isNil) { Error("Source inconnue : " ++ id).throw };
  if(source[\pending] == true) { Error("Source en cours de création : " ++ id).throw };
  source
};

~mxNodeIds = { |id|
  var nodes = ~mxSource.(id)[\nodes];
  [\input, \eq, \hp, \lp, \pitch, \dyn, \mix].collect { |key| nodes[key].nodeID }
};

~mxCompArgs = { |prefix, values|
  var v = ~mxRequire.(values, [\thresholdDb, \ratio, \attackMs, \releaseMs, \makeupDb, \bypass]);
  [\ThresholdDb, \Ratio, \AttackMs, \ReleaseMs, \MakeupDb, \Bypass].collect { |suffix, index|
    [(prefix ++ suffix).asSymbol, v[index]]
  }.flatten
};

~mxEqKind = { |values|
  var v = ~mxRequire.(values, [\low, \mid, \high]);
  if(v.every { |value| (value - 0.5).abs < 0.0001 }) { \eqdirect } { \eq }
};

~mxHpKind = { |values|
  var model = ~mxHpModels[~mxRequire.(values, [\model])[0]];
  if(model.isNil) { Error("Modèle de passe-haut inconnu : " ++ values[\model]).throw };
  if(model == 2) { \hp4 } { \hp }
};

~mxLpKind = { |values|
  var model = ~mxLpModels[~mxRequire.(values, [\model])[0]];
  if(model.isNil) { Error("Modèle de passe-bas inconnu : " ++ values[\model]).throw };
  [\lp, \lp, \lp4, \lpmoog][model]
};

// Contrôles de Synth correspondant à un étage de source.
~mxSourceStageArgs = { |stage, values|
  var v;
  switch(stage,
    \mix, {
      v = ~mxRequire.(values, [\volume, \cue, \mute, \balance]);
      [\volume, v[0], \cueLevel, v[1], \mute, v[2], \pan, v[3] * 2 - 1]
    },
    \input, { [\gain, ~mxRequire.(values, [\gain])[0]] },
    \inputCompressor, { ~mxCompArgs.("comp", values) },
    \eq, {
      v = ~mxRequire.(values, [\low, \mid, \high]);
      if(~mxEqKind.(values) == \eq) { [\eqLow, v[0], \eqMid, v[1], \eqHigh, v[2]] } { [] }
    },
    \hp, {
      v = ~mxRequire.(values, [\enabled, \model, \freq, \q, \mul, \add]);
      [\enabled, v[0], \freq, v[2], \q, v[3], \mul, v[4], \add, v[5]]
        ++ if(~mxHpKind.(values) == \hp) { [\model, ~mxHpModels[v[1]]] } { [] }
    },
    \lp, {
      var kind = ~mxLpKind.(values);
      v = ~mxRequire.(values, [\enabled, \model, \freq, \q, \gain, \mul, \add]);
      [\enabled, v[0], \freq, v[2], \mul, v[5], \add, v[6]]
        ++ switch(kind, \lpmoog, { [\gain, v[4]] }, \lp4, { [\q, v[3]] }, { [\q, v[3], \model, ~mxLpModels[v[1]]] })
    },
    \pitch, { [\pitch, ~mxRequire.(values, [\semitones])[0]] },
    { Error("Étage de source inconnu : " ++ stage).throw }
  )
};

~mxAddSource = { |id, meterId, firstChannel, width, proc|
  var server = ~mxServer;
  var source, group, bus, nodes, args, bands;
  if(~mxSources[id].notNil) {
    if(~mxSources[id][\pending] == true) { Error("Source en cours de création : " ++ id).throw };
    Error("Source déjà présente : " ++ id).throw;
  };
  if(firstChannel.isInteger.not or: { firstChannel < 1 }) { Error("Premier canal invalide : " ++ firstChannel).throw };
  if(width.isInteger.not or: { width < 1 }) { Error("Largeur invalide : " ++ width).throw };
  if(firstChannel + width - 1 > ~mxInputChannels) {
    Error("Canaux " ++ firstChannel ++ ".." ++ (firstChannel + width - 1)
      ++ " au-delà des " ++ ~mxInputChannels ++ " entrées").throw;
  };
  // Réservation avant toute attente (server.sync) : aucune autre commande ne peut prendre cet id.
  ~mxSources[id] = (id: id, pending: true);
  try {
    // Valide toutes les valeurs avant de créer le moindre nœud.
    args = IdentityDictionary.new;
    [\mix, \input, \inputCompressor, \eq, \hp, \lp, \pitch].do { |stage|
      args[stage] = ~mxSourceStageArgs.(stage, ~mxRequire.(proc, [stage])[0]);
    };
    bands = ~mxRequire.(proc, [\bandCompressor])[0];
    args[\bandCompressor] = [\low, \mid, \high].collect { |band|
      ~mxCompArgs.(band.asString, ~mxRequire.(bands, [band])[0])
    }.flatten;
    ~mxEnsureWidth.(width);

    bus = Bus.audio(server, width);
    nodes = IdentityDictionary.new;
    // Groupe et 7 Synths dans un seul bundle sans horodatage (Bundled-Messages : les messages d'un
    // bundle sont exécutés ensemble) : le serveur ne voit jamais une chaîne partielle.
    server.makeBundle(nil, {
      group = Group.tail(~mxSourcesGroup);
      nodes[\input] = Synth.tail(group, ~mxDefName.(\in, width), [\bus, bus.index,
        \firstChannel, firstChannel, \meterId, meterId] ++ args[\input] ++ args[\inputCompressor]);
      nodes[\eq] = Synth.tail(group, ~mxDefName.(~mxEqKind.(proc[\eq]), width), [\bus, bus.index] ++ args[\eq]);
      nodes[\hp] = Synth.tail(group, ~mxDefName.(~mxHpKind.(proc[\hp]), width), [\bus, bus.index] ++ args[\hp]);
      nodes[\lp] = Synth.tail(group, ~mxDefName.(~mxLpKind.(proc[\lp]), width), [\bus, bus.index] ++ args[\lp]);
      nodes[\pitch] = Synth.tail(group, ~mxDefName.(\pitch, width), [\bus, bus.index] ++ args[\pitch]);
      nodes[\dyn] = Synth.tail(group, ~mxDefName.(\dyn, width), [\bus, bus.index] ++ args[\bandCompressor]);
      nodes[\mix] = Synth.tail(group, ~mxDefName.(\mix, width), [\bus, bus.index,
        \out, ~mxMasterBus.index, \cueOut, ~mxCueBus.index] ++ args[\mix]);
    });

    source = (id: id, meterId: meterId, firstChannel: firstChannel, width: width,
      group: group, bus: bus, nodes: nodes,
      kinds: (eq: ~mxEqKind.(proc[\eq]), hp: ~mxHpKind.(proc[\hp]), lp: ~mxLpKind.(proc[\lp])));
    ~mxSources[id] = source;
    server.sync;
  } { |error|
    // Échec après réservation : libère l'id et ce qui a déjà été alloué.
    if(group.notNil) { group.free };
    if(bus.notNil) { bus.free };
    ~mxSources.removeAt(id);
    error.throw;
  };
  ~mxNodeIds.(id)
};

~mxRemoveSource = { |id|
  var source = ~mxSource.(id);
  source[\group].free;
  source[\bus].free;
  ~mxSources.removeAt(id);
  true
};

// Étage à modèle (eq, hp, lp) : remplacement du Synth à la même position si le SynthDef change.
~mxSetModelStage = { |source, stage, kind, args|
  var nodes = source[\nodes];
  if(source[\kinds][stage] != kind) {
    nodes[stage] = Synth.replace(nodes[stage], ~mxDefName.(kind, source[\width]),
      [\bus, source[\bus].index] ++ args);
    source[\kinds][stage] = kind;
  } {
    if(args.notEmpty) { nodes[stage].set(*args) };
  };
};

~mxSetSourceStage = { |id, stage, values|
  var source = ~mxSource.(id);
  var nodes = source[\nodes];
  var band;
  switch(stage,
    \eq, { ~mxSetModelStage.(source, \eq, ~mxEqKind.(values), ~mxSourceStageArgs.(\eq, values)) },
    \hp, { ~mxSetModelStage.(source, \hp, ~mxHpKind.(values), ~mxSourceStageArgs.(\hp, values)) },
    \lp, { ~mxSetModelStage.(source, \lp, ~mxLpKind.(values), ~mxSourceStageArgs.(\lp, values)) },
    \bandCompressor, {
      band = ~mxRequire.(values, [\band])[0].asSymbol;
      if([\low, \mid, \high].includes(band).not) { Error("Bande inconnue : " ++ band).throw };
      nodes[\dyn].set(*~mxCompArgs.(band.asString, values));
    },
    \mix, { nodes[\mix].set(*~mxSourceStageArgs.(\mix, values)) },
    \input, { nodes[\input].set(*~mxSourceStageArgs.(\input, values)) },
    \inputCompressor, { nodes[\input].set(*~mxSourceStageArgs.(\inputCompressor, values)) },
    \pitch, { nodes[\pitch].set(*~mxSourceStageArgs.(\pitch, values)) },
    { Error("Étage de source inconnu : " ++ stage).throw }
  );
  true
};

~mxResetMoog = { |id|
  var source = ~mxSource.(id);
  if(source[\kinds][\lp] != \lpmoog) { Error("Le passe-bas de " ++ id ++ " n'est pas MoogFF").throw };
  source[\nodes][\lp].set(\t_reset, 1);
  true
};

// === SORTIES : étages ===

~mxOutputStageArgs = { |stage, values|
  var v;
  switch(stage,
    \mix, { [\volume, ~mxRequire.(values, [\volume])[0]] },
    \eq, {
      v = ~mxRequire.(values, [\low, \mid, \high]);
      [\eqLow, v[0], \eqMid, v[1], \eqHigh, v[2]]
    },
    \infraHpf, {
      v = ~mxRequire.(values, [\enabled, \hz]);
      [\infraHpfEnabled, v[0], \infraHpfHz, v[1]]
    },
    \sideHpf, {
      v = ~mxRequire.(values, [\enabled, \hz]);
      [\sideHpfEnabled, v[0], \sideHpfHz, v[1]]
    },
    \clipper, {
      v = ~mxRequire.(values, [\enabled, \ceilingDb]);
      [\clipEnabled, v[0], \clipCeilingDb, v[1]]
    },
    \limiter, {
      v = ~mxRequire.(values, [\enabled, \ceilingDb]);
      [\limitEnabled, v[0], \limitCeilingDb, v[1]]
    },
    \compressor, {
      v = ~mxRequire.(values, [\thresholdDb, \slopeBelow, \slopeAbove, \attackMs, \releaseMs, \mul, \add, \bypass]);
      [\compThresholdDb, \compSlopeBelow, \compSlopeAbove, \compAttackMs, \compReleaseMs,
        \compMul, \compAdd, \compBypass].collect { |key, index| [key, v[index]] }.flatten
    },
    { Error("Étage de sortie inconnu : " ++ stage).throw }
  )
};

~mxSetOutputStage = { |output, stage, values|
  var state = ~mxOutputs[output];
  var args, model, params, replacement;
  if(state.isNil) { Error("Sortie inconnue : " ++ output).throw };
  args = ~mxOutputStageArgs.(stage, values);
  model = if(stage == \compressor) { ~mxRequire.(values, [\model])[0].asSymbol } { state[\model] };
  if(~mxCompressorDefs[model].isNil) { Error("Modèle de compresseur inconnu : " ++ model).throw };
  if(~mxModels[model] != true) { Error("Modèle de compresseur indisponible : " ++ model).throw };
  params = state[\params];

  if(model != state[\model]) {
    if(state[\phase] != \stable) { Error("Bascule de modèle de compresseur en cours").throw };
    args.pairsDo { |key, value| params[key] = value };
    // Le nouveau modèle écrit sur l'autre bus privé ; l'écrivain fait le fondu.
    state[\slot] = 1 - state[\slot];
    params[\out] = state[\slots][state[\slot]].index;
    replacement = Synth.before(state[\writer], ~mxCompressorDefs[model], params.asKeyValuePairs);
    state[\old] = state[\synth];
    state[\synth] = replacement;
    state[\model] = model;
    state[\phase] = \warming;
    // Laisse le nouveau compresseur établir ses enveloppes avant de l'exposer.
    state[\routine] = Routine({
      0.5.wait;
      state[\writer].set(\mix, state[\slot]);
      state[\phase] = \fading;
      // Durée du fondu de l'écrivain plus une marge de 0.25 s (≥ 40 périodes matérielles de 256 images à 48 kHz).
      (~mxFadeSeconds + ~mxFadeMarginSeconds).wait;
      state[\old].free;
      state[\old] = nil;
      state[\phase] = \stable;
      state[\routine] = nil;
    }).play(SystemClock);
  } {
    args.pairsDo { |key, value| params[key] = value };
    state[\synth].set(*args);
    // Pendant un fondu, les réglages s'appliquent aux deux signaux.
    if(state[\old].notNil) { state[\old].set(*args) };
  };
  true
};
