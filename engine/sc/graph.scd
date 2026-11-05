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
 *   ~mxAddSource.(id, meterId, firstChannel, width, proc)   -> ~mxNodeIds.(id)  (entrée en fondu, voir plus bas)
 *   ~mxReplaceSource.(id, meterId, firstChannel, width, proc)   -> ~mxNodeIds.(id)  (fondu enchaîné)
 *   ~mxRemoveSource.(id)                        -> fondu à zéro puis /n_free différé (voir plus bas)
 *   ~mxSetSourceStage.(id, stage, controls)
 *   ~mxSetOutputStage.(output, stage, controls)
 *   ~mxResetMoog.(id)
 *   ~mxNodeIds.(id)                             -> ID des 7 Synths, dans l'ordre de la chaîne
 *
 * RÈGLE DE NOMMAGE DES CONTRÔLES (une seule, sans table de correspondance).
 *   Le nom d'un contrôle de SynthDef est le nom du champ du contrat. Quand une SynthDef porte
 *   plusieurs groupes du contrat, le nom est préfixé : <groupe><Champ> (premier caractère du champ
 *   en majuscule). Groupes multiples : \mx_in_<w> (input, inputCompressor), \mx_dyn_<w> (low, mid,
 *   high, crossover : lowThresholdDb, crossoverLowMidFreq...) et la SynthDef de sortie
 *   \mx_output_* (mix, eq, infraHpf, sideHpf, clipper, limiter, compressor : eqLowFreq,
 *   limiterDurMs...). Les autres SynthDefs de source portent un seul groupe : champ seul.
 *   Les conversions (dB -> amp, 0..1 -> Hz, semitones -> rapport, ms -> s) sont dans les SynthDefs :
 *   `/n_set <nœud> <contrôle> <valeur>` avec le nom du contrat suffit (src/contract/controls.js
 *   calcule le préfixe, tests/parameters.test.js le compare aux SynthDefs construites).
 *   `proc` et `controls` sont des Events dont les clés sont ces noms de contrôles ; booléens en 0/1.
 *   Exceptions, toutes structurelles : la clé `model` (symbole) choisit la SynthDef et n'est jamais un
 *   contrôle ; la clé `band` (\low, \mid, \high, \crossover) désigne le groupe de \bandCompressor ;
 *   `proc` regroupe les contrôles par étage : (mix: (...), input: (...), inputCompressor: (...), eq,
 *   hp, lp, pitch, bandCompressor: (low: (...), mid: (...), high: (...), crossover: (...))).
 *   Les contrôles non applicables au modèle chargé (par exemple gain hors MoogFF, floorHz hors RHPF)
 *   sont mémorisés par l'API et ignorés ici.
 *   Étages de source : \mix \input \inputCompressor \eq \hp \lp \pitch \bandCompressor ; étages de
 *   sortie : \mix \eq \infraHpf \sideHpf \clipper \limiter \compressor ; sorties \master \cue.
 *
 * ARGUMENTS FIXÉS À LA CRÉATION (structure, pas valeur). windowSize de PitchShift et dur de Limiter ne
 * peuvent pas être modulés (PitchShift.schelp, Limiter.schelp : « cannot be modulated ») : le tampon est
 * alloué à la création du UGen. Leur changement recrée le Synth (source : Synth.replace ; sortie :
 * bascule avec fondu comme un changement de modèle) ; ce sont les seules valeurs qui passent par sclang.
 * L'EQ de source neutre (low = mid = high = 0.5, mul = 1, add = 0, valeurs exactes) est la SynthDef
 * \mx_eqdirect_<w> sans UGen d'égalisation ; en sortir recrée le Synth.
 *
 * RETRAIT D'UNE SOURCE (suppression, changement de largeur ou de canal, remplacement d'un preset).
 *   Server-Command-Reference, /n_free : libérer un nœud non silencieux peut produire un clic. Le Synth
 *   \mix passe donc à zéro (fadeGate 0, VarLag linéaire de fadeSeconds) avant la libération :
 *   fadeSeconds = max(~mxFadeSeconds, 2 périodes matérielles) ; la libération du groupe et du bus a lieu
 *   fadeSeconds + ~mxFadeMargin plus tard (SystemClock, sans horodatage). L'identifiant de la source est
 *   libre immédiatement ; le bus reste réservé jusqu'à la libération. Le vumètre de l'ancienne chaîne est coupé
 *   (meterId -1 : le relais ignore les identifiants inconnus), pour qu'un seul vumètre réponde sous un identifiant.
 *   Entrée en fondu : le VarLag de \mx_mix_<w> part de 0 (start: 0, constante fixe, Filter.sc : `start = start ? in`) vers
 *   fadeGate 1 (défaut) : toute chaîne monte de 0 à 1 en fadeSeconds = ~mxRemoveRamp dès son premier bloc de contrôle.
 *   Déplacement (PATCH de largeur ou de canaux, ~mxReplaceSource.(id, meterId, firstChannel, width, proc)) : les SynthDefs
 *   de la largeur sont construits d'abord (~mxEnsureWidth, avec attente), puis UN bundle fait descendre l'ancienne chaîne
 *   (fadeGate 0) et créer la nouvelle juste après elle (Group.after : Guides/Order-of-execution, les deux restent dans le
 *   groupe des sources, avant les sorties) : les deux rampes démarrent dans le même bloc, sans creux ni surcharge. Loi : amplitude linéaire
 *   complémentaire (g_ancien + g_nouveau = 1 à chaque instant, VarLag linéaire de même durée) : pour un matériau
 *   corrélé (même canal d'entrée) la somme garde le gain unitaire, alors que la loi à puissance égale donnerait
 *   jusqu'à +3 dB. Un matériau décorrélé baisse au plus de 3 dB au milieu du fondu.
 *
 * Vumètres (SendPeakRMS) : '/mx/source-meter' avec le meterId de la source,
 * un couple crête/RMS par canal ; '/mx/output-meter' avec les ID 0/1 (Master
 * gauche/droite) et 2/3 (Cue gauche/droite).
 */

(thisProcess.nowExecutingPath.dirname +/+ "source-defs.scd").load;

// Délai maximal du DelayN du modèle CompanderD : maximum de la plage d'attaque du contrat
// (attackMs 1..100, soit 0.1 s). Constante de SynthDef : la taille du tampon est fixée à la
// création (DelayN.schelp : maxdelaytime « used to initialize the delay buffer size »).
// C'est la définition de CompanderD (Compander.sc : DelayN.ar(in, clampTime, clampTime)) ; le délai
// effectif suit attackMs.
~mxCompanderDMaxDelay = 0.1;
// dur maximal du Limiter (s) : LIMITER_DUR_MAX_MS du contrat (schemas.js), dimensionnement de memSize.
~mxLimiterDurMaxSeconds = 0.05;
// Fondu du compresseur de sortie : durée par défaut du VarLag de l'écrivain (contrôle compressorFadeSeconds,
// champ compressor.fadeSeconds), puis marge avant de libérer l'ancien Synth (Server-Command-Reference
// /n_free : un nœud non silencieux libéré peut cliquer). Sert aussi de plancher au fondu de retrait de source.
~mxFadeSeconds = 0.05;
// Marge avant libération : 8 périodes matérielles (hardwareBufferSize / sampleRate du serveur, issus de
// l'horloge TimoxVasio) avec un plancher de 0.1 s. Le `set` du fondu et le `/n_free` partent sans
// horodatage ; la marge couvre la gigue d'ordonnancement SystemClock et le traitement par blocs. À 256
// images et 48 kHz (5.3 ms) le plancher s'applique ; à 2048 images la marge vaut 0.34 s.
~mxFadeMarginPeriods = 8;
~mxFadeMarginFloorSeconds = 0.1;
~mxHardwarePeriod = { |server|
  (server.options.hardwareBufferSize ? 0) / (server.sampleRate ? server.options.sampleRate ? 48000)
};
~mxFadeMargin = { |server|
  max(~mxFadeMarginFloorSeconds, ~mxFadeMarginPeriods * ~mxHardwarePeriod.(server))
};
// Durée du fondu de retrait : au moins une période matérielle (deux ici), jamais sous ~mxFadeSeconds.
~mxRemoveRamp = { |server| max(~mxFadeSeconds, 2 * ~mxHardwarePeriod.(server)) };
~mxInitDone = false;
~mxHpModels = [\BHiPass, \RHPF, \BHiPass4];
~mxLpModels = [\BLowPass, \RLPF, \BLowPass4, \MoogFF];
~mxCompressorDefs = (Compander: \mx_output_compander, CompanderD: \mx_output_companderD,
  FaustRMS: \mx_output_faustRMS);
// Contrôles de sortie lus à la création du UGen (voir ARGUMENTS FIXÉS À LA CRÉATION).
~mxOutputInitControls = [\limiterDurMs];
// Contrôles de l'écrivain de sortie (ce n'est pas le Synth du traitement).
~mxWriterControls = [\compressorFadeSeconds];
~mxOutputStages = [\mix, \eq, \infraHpf, \sideHpf, \clipper, \limiter, \compressor];

// Paires [clé, valeur, ...] d'un Event de contrôles, sans les clés structurelles `model` et `band`.
~mxControls = { |values|
  var pairs = List.new;
  if(values.isKindOf(Dictionary).not) { Error("Valeurs attendues sous forme d'Event").throw };
  values.keysValuesDo { |key, value|
    if([\model, \band].includes(key).not) { pairs.add(key); pairs.add(value) };
  };
  pairs.asArray
};

// Valeurs par défaut des contrôles d'une SynthDef (lues dans son SynthDesc, jamais redéclarées).
~mxDefaults = { |defName|
  var desc = SynthDescLib.global[defName];
  var defaults = ();
  if(desc.isNil) { Error("SynthDef inconnue : " ++ defName).throw };
  desc.controls.do { |control| defaults[control.name] = control.defaultValue };
  defaults
};

// Contrôles d'une liste de paires applicables à une SynthDef. `strict` : un contrôle inconnu lève une
// erreur ; sinon il est ignoré (champ non applicable au modèle chargé).
~mxForDef = { |defName, pairs, strict|
  var desc = SynthDescLib.global[defName];
  var known, kept = List.new;
  if(desc.isNil) { Error("SynthDef inconnue : " ++ defName).throw };
  known = desc.controls.collect { |control| control.name };
  pairs.pairsDo { |key, value|
    if(known.includes(key)) { kept.add(key); kept.add(value) } {
      if(strict) { Error("Contrôle inconnu " ++ key ++ " pour " ++ defName).throw };
    };
  };
  kept.asArray
};

// === SORTIES (filtres infra et latéral, EQ, volume, écrêteur, limiteur, compresseur) ===
// `compress.(sig, thresholdDb, slopeBelow, slopeAbove, attackMs, releaseMs, mul, add)` construit le modèle
// de compresseur (unités du contrat : dB et ms).
~mxOutputDef = { |name, compress|
  SynthDef(name, {
    var in = \in.kr(0), out = \out.kr(0);
    var sig = In.ar(in, 2);
    var lg = { |group, field, default| ~mxLg.(group, field, default) };
    var dry, mid, side, limited, compressed;

    sig = sig + ((HPF.ar(sig, lg.(\infraHpf, \hz, 25), lg.(\infraHpf, \mul, 1), lg.(\infraHpf, \add, 0)) - sig)
      * lg.(\infraHpf, \enabled, 0));
    mid = (sig[0] + sig[1]) * 0.5;
    side = (sig[0] - sig[1]) * 0.5;
    side = side + ((HPF.ar(side, lg.(\sideHpf, \hz, 100), lg.(\sideHpf, \mul, 1), lg.(\sideHpf, \add, 0)) - side)
      * lg.(\sideHpf, \enabled, 0));
    sig = [mid + side, mid - side];

    sig = ~mxEqChain.(sig, \eq, 200);

    // Le volume précède le compresseur final.
    sig = sig * lg.(\mix, \volume, 1);

    sig = sig + ((Clip.ar(sig, lg.(\clipper, \lo, -1), lg.(\clipper, \hi, 1)) - sig) * lg.(\clipper, \enabled, 0));
    // dur : argument fixé à la création du UGen, donc ni lissé ni modulé ; borné au maximum du contrat.
    limited = Limiter.ar(sig, lg.(\limiter, \ceilingDb, -1).dbamp,
      (~mxCtl.(\limiter, \durMs, 10) / 1000).min(~mxLimiterDurMaxSeconds));
    sig = sig + ((limited - sig) * lg.(\limiter, \enabled, 0));

    // Le compresseur est le dernier traitement audio.
    compressed = compress.(sig, lg.(\compressor, \thresholdDb, -20), lg.(\compressor, \slopeBelow, 1),
      lg.(\compressor, \slopeAbove, 0.25), lg.(\compressor, \attackMs, 10), lg.(\compressor, \releaseMs, 100),
      lg.(\compressor, \mul, 1), lg.(\compressor, \add, 0));
    sig = Select.ar(~mxCtl.(\compressor, \bypass, 1), [compressed, sig]);

    Out.ar(out, sig);
  })
};

// SynthDefs de sortie : un par modèle de compresseur ; `faust` inclut FaustRMS (plug-in chargé).
~mxBuildOutputDefs = { |faust|
  var defs = [
    ~mxOutputDef.(\mx_output_compander, { |sig, threshold, below, above, attack, release, mul, add|
      Compander.ar(sig, sig, threshold.dbamp, below, above, attack / 1000, release / 1000, mul, add)
    }),
    // Équivalent de CompanderD.ar (Compander.sc : DelayN.ar(in, clampTime, clampTime) en entrée de traitement,
    // signal direct en contrôle) mais avec un maxdelaytime fixe (~mxCompanderDMaxDelay) : une attaque
    // modifiée après la création du Synth reste valide.
    ~mxOutputDef.(\mx_output_companderD, { |sig, threshold, below, above, attack, release, mul, add|
      Compander.ar(DelayN.ar(sig, ~mxCompanderDMaxDelay, (attack / 1000).min(~mxCompanderDMaxDelay)), sig,
        threshold.dbamp, below, above, attack / 1000, release / 1000).madd(mul, add)
    })
  ];
  if(faust) {
    defs = defs ++ [~mxOutputDef.(\mx_output_faustRMS, { |sig, threshold, below, above, attack, release, mul, add|
      \MixetteFaustRMS.asClass.ar(sig[0], sig[1], threshold, below, above, attack, release) * mul + add
    })];
  };
  defs
};

// Seul écrivain matériel de chaque sortie ; les processeurs écrivent sur deux bus privés. La durée du fondu
// est le champ compressor.fadeSeconds (contrôle compressorFadeSeconds).
~mxOutputWriterDef = SynthDef(\mx_output_writer, { |inA, inB, out, mix=0, meterId=0|
  // warp et curvature sont fixés à la construction (Filter.sc, VarLag.new1 : `curve = Env.shapeNames[warp] ? warp; if(curve != 1)`
  // choisit à la compilation du SynthDef entre le UGen VarLag, linéaire, et un EnvGen dont le niveau initial est `in`) : warp
  // ne peut pas être un contrôle, et curvature n'agit que pour warp 5 (VarLag.schelp). Rampe linéaire.
  var blend = VarLag.kr(mix, ~mxCtl.(\compressor, \fadeSeconds, ~mxFadeSeconds), warp: \linear);
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
  found = ~mxSynthDefLoaded.(server, name, ~mxSynthDefTimeout);
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

  ~mxBuildOutputDefs.(faustLoaded).do { |def| def.add };
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
    // Valeurs courantes des contrôles : celles de la SynthDef jusqu'au premier réglage de l'API.
    var params = ~mxDefaults.(~mxCompressorDefs[\Compander]);
    params[\in] = if(name == \master) { ~mxMasterBus.index } { ~mxCueBus.index };
    params[\out] = slots[0].index;
    ~mxOutputs[name] = (name: name, slots: slots, slot: 0, params: params, model: \Compander,
      synth: Synth.tail(~mxOutputGroup, \mx_output_compander, [\in, params[\in], \out, params[\out]]),
      phase: \stable, old: nil, routine: nil,
      fadeSeconds: ~mxDefaults.(\mx_output_writer)[\compressorFadeSeconds]);
  };
  // Master vers les sorties matérielles 0/1, Cue vers 2/3.
  [\master, \cue].do { |name, index|
    var output = ~mxOutputs[name];
    output[\writer] = Synth.tail(~mxOutputGroup, \mx_output_writer, [
      \inA, output[\slots][0].index, \inB, output[\slots][1].index,
      \out, index * 2, \meterId, index * 2]);
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

// Valeurs d'un étage de `proc` ; un étage absent est une erreur.
~mxStageValues = { |proc, stage|
  var values = proc[stage];
  if(values.isNil) { Error("Champ manquant : " ++ stage).throw };
  values
};

// EQ neutre : valeurs exactes (aucun seuil), voir l'en-tête.
~mxEqKind = { |values|
  var neutral = [\low, \mid, \high].every { |key| values[key] == 0.5 }
    and: { [\lowMul, \midMul, \highMul].every { |key| values[key] == 1 }
      and: { [\lowAdd, \midAdd, \highAdd].every { |key| values[key] == 0 } } };
  if(neutral) { \eqdirect } { \eq }
};

~mxHpKind = { |values|
  var model = values[\model];
  if(~mxHpModels.includes(model).not) { Error("Modèle de passe-haut inconnu : " ++ model).throw };
  ("hp" ++ model).asSymbol
};

~mxLpKind = { |values|
  var model = values[\model];
  if(~mxLpModels.includes(model).not) { Error("Modèle de passe-bas inconnu : " ++ model).throw };
  ("lp" ++ model).asSymbol
};

// Étage de `proc` -> clé du nœud de la chaîne qui le porte.
~mxStageNode = (mix: \mix, input: \input, inputCompressor: \input, eq: \eq, hp: \hp, lp: \lp,
  pitch: \pitch, bandCompressor: \dyn);
~mxBandGroups = [\low, \mid, \high, \crossover];

// Nom de la SynthDef du nœud `key` de la source.
~mxNodeDef = { |source, key| ~mxDefName.(source[\kinds][key], source[\width]) };

// Création d'une source. `old` (source à remplacer, ou nil) : le fondu de sortie de l'ancienne chaîne et la création de la
// nouvelle partent dans le MÊME bundle (mêmes blocs de contrôle), la nouvelle chaîne étant placée juste après l'ancienne.
~mxCreateSource = { |id, meterId, firstChannel, width, proc, old|
  var server = ~mxServer;
  var source, group, bus, nodes, kinds, args, bands;
  var ramp = ~mxRemoveRamp.(server);
  if(old.isNil and: { ~mxSources[id].notNil }) {
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
    kinds = (input: \in, eq: ~mxEqKind.(~mxStageValues.(proc, \eq)), hp: ~mxHpKind.(~mxStageValues.(proc, \hp)),
      lp: ~mxLpKind.(~mxStageValues.(proc, \lp)), pitch: \pitch, dyn: \dyn, mix: \mix);
    bands = ~mxStageValues.(proc, \bandCompressor);
    ~mxEnsureWidth.(width);
    args = (
      input: ~mxForDef.(~mxDefName.(\in, width),
        ~mxControls.(~mxStageValues.(proc, \input)) ++ ~mxControls.(~mxStageValues.(proc, \inputCompressor)), true),
      eq: if(kinds[\eq] == \eq) { ~mxForDef.(~mxDefName.(\eq, width), ~mxControls.(proc[\eq]), true) } { [] },
      hp: ~mxForDef.(~mxDefName.(kinds[\hp], width), ~mxControls.(proc[\hp]), false),
      lp: ~mxForDef.(~mxDefName.(kinds[\lp], width), ~mxControls.(proc[\lp]), false),
      pitch: ~mxForDef.(~mxDefName.(\pitch, width), ~mxControls.(~mxStageValues.(proc, \pitch)), true),
      dyn: ~mxForDef.(~mxDefName.(\dyn, width), ~mxBandGroups.collect { |g|
        ~mxControls.(~mxStageValues.(bands, g)) }.flatten, true),
      mix: ~mxForDef.(~mxDefName.(\mix, width), ~mxControls.(~mxStageValues.(proc, \mix)), true)
    );

    bus = Bus.audio(server, width);
    nodes = IdentityDictionary.new;
    // Groupe et 7 Synths dans un seul bundle sans horodatage (Bundled-Messages : les messages d'un
    // bundle sont exécutés ensemble) : le serveur ne voit jamais une chaîne partielle.
    server.makeBundle(nil, {
      if(old.notNil) {
        // Fondu enchaîné : l'ancienne chaîne descend (fadeGate 0) dans le bundle où la nouvelle monte (VarLag start 0).
        old[\nodes][\mix].set(\fadeSeconds, ramp, \fadeGate, 0);
        old[\nodes][\input].set(\meterId, -1);
      };
      // Guides/Order-of-execution : la nouvelle chaîne reste dans le groupe des sources (avant les sorties), juste après l'ancienne.
      group = if(old.notNil) { Group.after(old[\group]) } { Group.tail(~mxSourcesGroup) };
      nodes[\input] = Synth.tail(group, ~mxDefName.(kinds[\input], width), [\bus, bus.index,
        \firstChannel, firstChannel, \meterId, meterId] ++ args[\input]);
      nodes[\eq] = Synth.tail(group, ~mxDefName.(kinds[\eq], width), [\bus, bus.index] ++ args[\eq]);
      nodes[\hp] = Synth.tail(group, ~mxDefName.(kinds[\hp], width), [\bus, bus.index] ++ args[\hp]);
      nodes[\lp] = Synth.tail(group, ~mxDefName.(kinds[\lp], width), [\bus, bus.index] ++ args[\lp]);
      nodes[\pitch] = Synth.tail(group, ~mxDefName.(\pitch, width), [\bus, bus.index] ++ args[\pitch]);
      nodes[\dyn] = Synth.tail(group, ~mxDefName.(\dyn, width), [\bus, bus.index] ++ args[\dyn]);
      nodes[\mix] = Synth.tail(group, ~mxDefName.(\mix, width), [\bus, bus.index,
        \out, ~mxMasterBus.index, \cueOut, ~mxCueBus.index] ++ args[\mix]
        ++ [\fadeSeconds, ramp]);
    });

    source = (id: id, meterId: meterId, firstChannel: firstChannel, width: width,
      group: group, bus: bus, nodes: nodes, kinds: kinds,
      pitchWindow: proc[\pitch][\windowSize]);
    ~mxSources[id] = source;
    server.sync;
    if(old.notNil) { ~mxScheduleFree.(old) };
  } { |error|
    // Échec après réservation : libère l'id et ce qui a déjà été alloué.
    if(group.notNil) { group.free };
    if(bus.notNil) { bus.free };
    if(old.notNil) { ~mxSources[id] = old } { ~mxSources.removeAt(id) };
    error.throw;
  };
  ~mxNodeIds.(id)
};

~mxAddSource = { |id, meterId, firstChannel, width, proc|
  ~mxCreateSource.(id, meterId, firstChannel, width, proc, nil)
};

// Déplacement ou remplacement d'une source existante (PATCH de largeur ou de canaux) : les SynthDefs de la largeur sont
// construits d'abord (~mxEnsureWidth, avec attente), puis un seul bundle fait descendre l'ancienne chaîne et monter la nouvelle.
~mxReplaceSource = { |id, meterId, firstChannel, width, proc|
  var old = ~mxSource.(id);
  ~mxEnsureWidth.(width);
  // L'attente ci-dessus a pu laisser passer une autre commande : l'ancienne chaîne doit être toujours la source de l'id.
  if(~mxSources[id] !== old) { Error("Source modifiée pendant la construction : " ++ id).throw };
  ~mxCreateSource.(id, meterId, firstChannel, width, proc, old)
};

// Libération différée du groupe et du bus d'une source dont le fondu de sortie est lancé.
~mxScheduleFree = { |source|
  SystemClock.sched(~mxRemoveRamp.(~mxServer) + ~mxFadeMargin.(~mxServer), {
    source[\group].free;
    source[\bus].free;
    nil
  });
};

// Retrait : fondu à zéro (étage \mix), puis libération différée du groupe et du bus (voir l'en-tête).
~mxRemoveSource = { |id|
  var source = ~mxSource.(id);
  source[\nodes][\mix].set(\fadeSeconds, ~mxRemoveRamp.(~mxServer), \fadeGate, 0);
  // Un seul vumètre par identifiant.
  source[\nodes][\input].set(\meterId, -1);
  ~mxSources.removeAt(id);
  ~mxScheduleFree.(source);
  true
};

// Remplacement du Synth d'un étage à la même position (changement de modèle ou argument fixé à la création).
~mxReplaceStage = { |source, key, kind, args|
  var nodes = source[\nodes];
  nodes[key] = Synth.replace(nodes[key], ~mxDefName.(kind, source[\width]), [\bus, source[\bus].index] ++ args);
  source[\kinds][key] = kind;
};

// Étage à modèle (eq, hp, lp) : remplacement si la SynthDef change, sinon réglage direct.
~mxSetModelStage = { |source, stage, kind, controls, strict|
  var old = source[\kinds][stage];
  var args = if(kind == \eqdirect) { [] } { ~mxForDef.(~mxDefName.(kind, source[\width]), ~mxControls.(controls), strict) };
  if(old != kind) {
    ~mxReplaceStage.(source, stage, kind, args);
  } {
    if(args.notEmpty) { source[\nodes][stage].set(*args) };
  };
};

~mxSetSourceStage = { |id, stage, values|
  var source = ~mxSource.(id);
  var nodes = source[\nodes];
  var key = ~mxStageNode[stage];
  var args, window;
  if(key.isNil) { Error("Étage de source inconnu : " ++ stage).throw };
  if(stage == \bandCompressor and: { ~mxBandGroups.includes(values[\band]).not }) {
    Error("Bande inconnue : " ++ values[\band]).throw;
  };
  switch(stage,
    \eq, { ~mxSetModelStage.(source, \eq, ~mxEqKind.(values), values, true) },
    \hp, { ~mxSetModelStage.(source, \hp, ~mxHpKind.(values), values, false) },
    \lp, { ~mxSetModelStage.(source, \lp, ~mxLpKind.(values), values, false) },
    \pitch, {
      args = ~mxForDef.(~mxNodeDef.(source, \pitch), ~mxControls.(values), true);
      window = values[\windowSize];
      if(window.notNil and: { window != source[\pitchWindow] }) {
        // PitchShift alloue son tampon à la création : un nouveau windowSize recrée le Synth.
        ~mxReplaceStage.(source, \pitch, \pitch, args);
        source[\pitchWindow] = window;
      } {
        nodes[\pitch].set(*args);
      };
    },
    {
      args = ~mxForDef.(~mxNodeDef.(source, key), ~mxControls.(values), true);
      nodes[key].set(*args);
    }
  );
  true
};

~mxResetMoog = { |id|
  var source = ~mxSource.(id);
  if(source[\kinds][\lp] != \lpMoogFF) { Error("Le passe-bas de " ++ id ++ " n'est pas MoogFF").throw };
  source[\nodes][\lp].set(\reset, 1);
  true
};

// === SORTIES : étages ===

~mxSetOutputStage = { |output, stage, values|
  var state = ~mxOutputs[output];
  var all, args, writerArgs, model, params, replacement, restructure;
  if(state.isNil) { Error("Sortie inconnue : " ++ output).throw };
  if(~mxOutputStages.includes(stage).not) { Error("Étage de sortie inconnu : " ++ stage).throw };
  all = ~mxControls.(values);
  writerArgs = List.new;
  args = List.new;
  all.pairsDo { |key, value|
    if(~mxWriterControls.includes(key)) { writerArgs.add(key); writerArgs.add(value) } { args.add(key); args.add(value) };
  };
  model = if(stage == \compressor) { values[\model] } { state[\model] };
  if(~mxCompressorDefs[model].isNil) { Error("Modèle de compresseur inconnu : " ++ model).throw };
  if(~mxModels[model] != true) { Error("Modèle de compresseur indisponible : " ++ model).throw };
  args = ~mxForDef.(~mxCompressorDefs[model], args.asArray, true);
  writerArgs = ~mxForDef.(\mx_output_writer, writerArgs.asArray, true);
  params = state[\params];
  restructure = model != state[\model];
  args.pairsDo { |key, value|
    if(~mxOutputInitControls.includes(key) and: { params[key] != value }) { restructure = true };
  };
  if(restructure and: { state[\phase] != \stable }) { Error("Bascule de compresseur en cours").throw };
  if(writerArgs.notEmpty) {
    state[\writer].set(*writerArgs);
    writerArgs.pairsDo { |key, value| if(key == \compressorFadeSeconds) { state[\fadeSeconds] = value } };
  };

  if(restructure) {
    args.pairsDo { |key, value| params[key] = value };
    // Le nouveau Synth écrit sur l'autre bus privé ; l'écrivain fait le fondu.
    state[\slot] = 1 - state[\slot];
    params[\out] = state[\slots][state[\slot]].index;
    replacement = Synth.before(state[\writer], ~mxCompressorDefs[model], params.asKeyValuePairs);
    state[\old] = state[\synth];
    state[\synth] = replacement;
    state[\model] = model;
    state[\phase] = \warming;
    // Laisse le nouveau Synth établir ses enveloppes avant de l'exposer.
    state[\routine] = Routine({
      0.5.wait;
      state[\writer].set(\mix, state[\slot]);
      state[\phase] = \fading;
      // Durée du fondu de l'écrivain plus la marge dérivée de la période matérielle (~mxFadeMargin).
      (state[\fadeSeconds] + ~mxFadeMargin.(~mxServer)).wait;
      state[\old].free;
      state[\old] = nil;
      state[\phase] = \stable;
      state[\routine] = nil;
    }).play(SystemClock);
  } {
    args.pairsDo { |key, value| params[key] = value };
    if(args.notEmpty) { state[\synth].set(*args) };
    // Pendant un fondu, les réglages s'appliquent aux deux signaux.
    if(state[\old].notNil and: { args.notEmpty }) { state[\old].set(*args) };
  };
  true
};
