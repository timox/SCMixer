/*
 * Point d'entrée du moteur SuperCollider.
 *
 * Le lanceur substitue les jetons __MX_SC_DIR__, __MX_DEVICE__,
 * __MX_SAMPLE_RATE__, __MX_BUFFER__ et __MX_RELAY_PORT__ ainsi que les jetons de
 * dimensionnement __MX_NUM_INPUTS__, __MX_NUM_OUTPUTS__, __MX_NUM_AUDIO_BUSES__,
 * __MX_WIRE_BUFS__, __MX_MAX_NODES__, __MX_MEM_SIZE_KB__, __MX_BLOCK_SIZE__ et __MX_SYNTHDEF_TIMEOUT__ (calculés par
 * src/runtime/server-options.js à partir des besoins mesurés) avant l'exécution. Ce fichier
 * ne contient que la configuration du serveur et le démarrage ; le graphe, les SynthDefs
 * et les fonctions ~mx* sont dans graph.scd (sans jeton, donc chargeable par
 * les tests contre leur propre serveur) et source-defs.scd.
 *
 * Le dossier plugins/ doit figurer dans les includePaths de sclang pour que la
 * classe MixetteFaustRMS soit compilée ; scsynth y charge le plug-in .scx.
 * Sans elle, ou si scsynth ne charge pas le plug-in, le modèle FaustRMS est signalé
 * indisponible dans ~mxModels (sonde côté serveur dans ~mxInit).
 */
var dir = "__MX_SC_DIR__";
var options;

// Échec de démarrage : une ligne "MX-ENGINE-FAIL <cause>" est écrite sur la sortie de sclang (capturée par le
// lanceur, qui l'attache à l'erreur renvoyée par l'API), puis l'erreur est levée.
~mxBootState = 0;
~mxFail = { |reason|
  ~mxBootState = -1;
  ("MX-ENGINE-FAIL " ++ reason).postln;
  Error(reason).throw
};
// Délai (s) de vérification du chargement d'un SynthDef (jeton calculé par server-options.js).
~mxSynthDefTimeout = __MX_SYNTHDEF_TIMEOUT__;

// Serveur dédié : UDP 57130 sur la boucle locale (57110 appartient à un autre produit).
s = Server(\mxEngine, NetAddr("127.0.0.1", 57130), ServerOptions.new);
Server.default = s;
// Aucun Bus.audio avant le boot : l'allocateur client n'est reconstruit qu'à la connexion au serveur
// (Server.sc, clientID_ -> newAllocators) ; avant cela le premier bus alloué serait l'indice 4 (entrée matérielle).
~mxPreBootAudioTop = s.audioBusAllocator.top;
options = s.options;
options.device = "__MX_DEVICE__";
options.sampleRate = __MX_SAMPLE_RATE__;
options.hardwareBufferSize = __MX_BUFFER__;
options.blockSize = __MX_BLOCK_SIZE__;
// Ordre significatif (ServerOptions : numInputBusChannels_ / numOutputBusChannels_ recalculent
// numAudioBusChannels à partir du nombre de bus privés) : entrées, sorties, puis total des bus audio.
options.numInputBusChannels = __MX_NUM_INPUTS__;
options.numOutputBusChannels = __MX_NUM_OUTPUTS__;
options.numAudioBusChannels = __MX_NUM_AUDIO_BUSES__;
options.numWireBufs = __MX_WIRE_BUFS__;
options.maxNodes = __MX_MAX_NODES__;
options.memSize = __MX_MEM_SIZE_KB__;
options.ugenPluginsPath = [Platform.resourceDir +/+ "plugins", dir +/+ "plugins"];
// Vérification du résultat des setters (un ordre inversé décalerait le premier bus privé).
if(options.firstPrivateBus != (options.numInputBusChannels + options.numOutputBusChannels)
  or: { options.numAudioBusChannels != __MX_NUM_AUDIO_BUSES__ }) {
  ~mxFail.("Options de bus incohérentes : firstPrivateBus=" ++ options.firstPrivateBus
    ++ " numAudioBusChannels=" ++ options.numAudioBusChannels);
};
// Valeurs effectivement appliquées, relues depuis ServerOptions (journal sclang.log à chaque démarrage).
("MX-ENGINE-OPTIONS " ++ [\numInputBusChannels, \numOutputBusChannels, \numAudioBusChannels,
  \firstPrivateBus, \numWireBufs, \maxNodes, \memSize, \blockSize, \hardwareBufferSize, \sampleRate].collect { |key|
  key ++ "=" ++ options.perform(key)
}.join(" ")).postln;

(dir +/+ "graph.scd").load;
(dir +/+ "recording.scd").load;

// Acquittement des commandes : la file Node attend '/mx/ack' (identifiant, "ok" ou "error", message).
~mxRelayPort = __MX_RELAY_PORT__;
~mxAck = { |reqId, status, message|
  NetAddr("127.0.0.1", ~mxRelayPort).sendMsg('/mx/ack', reqId, status, message)
};

// Relais OSC vers le service Node (port __MX_RELAY_PORT__). Les réponses SendPeakRMS arrivent à sclang :
// elles sont retransmises telles quelles (Master et Cue). Création unique par démarrage : les
// OSCdef nommés sont remplacés, la routine précédente est arrêtée ; tout est libéré à l'arrêt.
~mxLastFail = "";
~mxStopRelay = {
  ~mxRuntimeRoutine !? { ~mxRuntimeRoutine.stop };
  ~mxRuntimeRoutine = nil;
  [\mxSourceMeterRelay, \mxOutputMeterRelay, \mxFailCapture, \mxStatusSeen].do { |name| OSCdef.all[name] !? { |def| def.free } };
};
~mxStartRelay = {
  var relay = NetAddr("127.0.0.1", ~mxRelayPort);
  ~mxStopRelay.value;
  OSCdef(\mxSourceMeterRelay, { |msg| relay.sendMsg(*msg) }, '/mx/source-meter', s.addr);
  OSCdef(\mxOutputMeterRelay, { |msg| relay.sendMsg(*msg) }, '/mx/output-meter', s.addr);
  OSCdef(\mxFailCapture, { |msg| ~mxLastFail = msg.drop(1).join(" ") }, '/fail', s.addr);
  // Heure de la dernière réponse /status.reply : son âge est envoyé avec chaque statut. scsynth répond au
  // rythme des appels audio ; sans audio, l'âge grandit et le service déclare le moteur en échec.
  ~mxLastStatusReply = Main.elapsedTime;
  OSCdef(\mxStatusSeen, { ~mxLastStatusReply = Main.elapsedTime }, '/status.reply', s.addr);
  ~mxRuntimeRoutine = Routine({
    loop {
      s.status;
      0.25.wait;
      if([s.avgCPU, s.peakCPU, s.numUGens, s.numSynths, s.numGroups, s.sampleRate, s.actualSampleRate, s.latency].every { |v| v.isNumber }) {
        relay.sendMsg('/mx/runtime', s.avgCPU, s.peakCPU, s.numSynths, s.numUGens, s.numGroups,
          s.options.sampleRate ? s.sampleRate, s.actualSampleRate, s.options.blockSize ? 64,
          s.options.hardwareBufferSize ? -1, s.latency * 1000, ~mxLastFail, Main.elapsedTime - ~mxLastStatusReply);
      };
      0.75.wait;
    }
  }).play(SystemClock);
};
ShutDown.add({ ~mxStopRelay.value });

// Garde : aucune allocation de bus audio client n'a eu lieu avant le boot (l'allocateur serait périmé).
if(s.audioBusAllocator.top != ~mxPreBootAudioTop) {
  ~mxFail.("Bus.audio alloué avant le boot du serveur (allocateur non reconstruit)");
};

s.waitForBoot({
  try {
    ~mxInit.(s);
    ~mxStartRelay.value;
    ~mxBootState = 1;
    "MX-ENGINE-READY".postln;
  } { |error|
    ~mxBootState = -1;
    ("MX-ENGINE-FAIL initialisation du graphe : " ++ error.errorString).postln;
  };
}, onFailure: {
  ~mxBootState = -1;
  "MX-ENGINE-FAIL démarrage du serveur impossible".postln;
});
