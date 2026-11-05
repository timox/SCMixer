/*
 * Disponibilité des modèles vérifiée côté serveur.
 *
 * Serveur dédié \mxmodels sur 127.0.0.1:57142, sortie MME (jamais ASIO), sans entrée matérielle.
 * Contrairement au test de graphe, ugenPluginsPath ne contient PAS sc/plugins : la classe sclang
 * MixetteFaustRMS existe (includePaths du lanceur de test) mais scsynth ne peut pas charger le
 * plug-in .scx. ~mxInit doit alors signaler FaustRMS indisponible (sonde côté serveur), alors qu'un
 * test de simple présence de la classe répondrait vrai.
 * Vérifie aussi qu'un échec de /d_recv côté serveur n'est pas pris pour une largeur construite.
 * Verdict : "MX-TEST-OK" ou "MX-TEST-FAIL <raison>", puis 0.exit.
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var server = Server(\mxmodels, NetAddr("127.0.0.1", 57142));
var done = false;
var finish, fail, check;

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

SystemClock.sched(50, { fail.("délai dépassé dans le test sclang"); nil });

server.options.device = "MME : Mappeur de sons Microsoft - Output";
server.options.numInputBusChannels = 0;
server.options.numOutputBusChannels = 4;

(root +/+ "sc" +/+ "graph.scd").load;

server.waitForBoot({
  try {
    var raised;
    ("MX-TEST-SCSYNTH-PID " ++ server.pid).postln;
    check.(\MixetteFaustRMS.asClass.notNil, "la classe MixetteFaustRMS devrait exister (includePaths)");
    ~mxInit.(server, 0);
    check.(~mxModels[\FaustRMS] == false, "FaustRMS déclaré disponible alors que scsynth n'a pas chargé le plug-in : " ++ ~mxModels);
    check.(~mxModels[\Compander] == true and: { ~mxModels[\CompanderD] == true }, "modèles standard " ++ ~mxModels);
    check.(~mxCompressorDefs[\FaustRMS].notNil, "table des défs");
    // Une bascule vers un modèle indisponible est refusée.
    raised = false;
    try {
      ~mxSetOutputStage.(\master, \compressor, (model: \FaustRMS, thresholdDb: -20, slopeBelow: 1, slopeAbove: 0.25,
        attackMs: 10, releaseMs: 100, mul: 1, add: 0, bypass: 0))
    } { |error| raised = error.errorString.find("indisponible").notNil };
    check.(raised, "bascule vers FaustRMS indisponible acceptée");

    // Échec de /d_recv côté serveur (UGen absent) : ~mxEnsureWidth lève et ne marque pas la largeur.
    ~mxBuildSourceDefs = { |w|
      [SynthDef(~mxDefName.(\in, w), { Out.ar(0, \MixetteFaustRMS.asClass.ar(DC.ar(0), DC.ar(0), -20, 1, 0.25, 10, 100)) })]
    };
    raised = false;
    try { ~mxEnsureWidth.(3) } { |error| raised = error.errorString.find("Échec serveur").notNil };
    check.(raised, "~mxEnsureWidth n'a pas signalé l'échec du serveur");
    check.(~mxBuiltWidths.includes(3).not, "largeur marquée construite malgré l'échec");

    finish.("MX-TEST-OK");
  } { |error|
    fail.(error.errorString);
  };
}, onFailure: { fail.("démarrage du serveur impossible") });
)
