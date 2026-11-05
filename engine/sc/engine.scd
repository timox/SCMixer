/*
 * Point d'entrée du moteur SuperCollider.
 *
 * Le lanceur substitue les jetons __MX_SC_DIR__, __MX_DEVICE__,
 * __MX_SAMPLE_RATE__, __MX_BUFFER__ et __MX_RELAY_PORT__ avant l'exécution. Ce fichier ne contient
 * que la configuration du serveur et le démarrage ; le graphe, les SynthDefs
 * et les fonctions ~mx* sont dans graph.scd (sans jeton, donc chargeable par
 * les tests contre leur propre serveur) et source-defs.scd.
 *
 * Le dossier plugins/ doit figurer dans les includePaths de sclang pour que la
 * classe MixetteFaustRMS soit compilée ; scsynth y charge le plug-in .scx.
 * Sans elle, le modèle FaustRMS est signalé indisponible dans ~mxModels.
 */
var dir = "__MX_SC_DIR__";

// Serveur dédié : UDP 57130 sur la boucle locale (57110 appartient à un autre produit).
s = Server(\mxEngine, NetAddr("127.0.0.1", 57130), ServerOptions.new);
Server.default = s;
s.options.device = "__MX_DEVICE__";
s.options.sampleRate = __MX_SAMPLE_RATE__;
s.options.hardwareBufferSize = __MX_BUFFER__;
s.options.numInputBusChannels = 256;
s.options.numOutputBusChannels = 4;
// Marge pour des sources jusqu'à 256 canaux : bus privés, tampons d'interconnexion, mémoire de PitchShift.
s.options.numAudioBusChannels = 2048;
s.options.numWireBufs = 8192;
s.options.memSize = 262144;
s.options.ugenPluginsPath = [Platform.resourceDir +/+ "plugins", dir +/+ "plugins"];

(dir +/+ "graph.scd").load;

// Acquittement des commandes : la file Node attend '/mx/ack' (identifiant, "ok" ou "error", message).
~mxRelayPort = __MX_RELAY_PORT__;
~mxAck = { |reqId, status, message|
  NetAddr("127.0.0.1", ~mxRelayPort).sendMsg('/mx/ack', reqId, status, message)
};
~mxBootState = 0;

// Relais OSC vers le service Node (port __MX_RELAY_PORT__). Les réponses SendPeakRMS arrivent à sclang :
// elles sont retransmises telles quelles (Master et Cue). Création unique par démarrage : les
// OSCdef nommés sont remplacés, la routine précédente est arrêtée ; tout est libéré à l'arrêt.
~mxLastFail = "";
~mxStopRelay = {
  ~mxRuntimeRoutine !? { ~mxRuntimeRoutine.stop };
  ~mxRuntimeRoutine = nil;
  [\mxSourceMeterRelay, \mxOutputMeterRelay, \mxFailCapture].do { |name| OSCdef.all[name] !? { |def| def.free } };
};
~mxStartRelay = {
  var relay = NetAddr("127.0.0.1", ~mxRelayPort);
  ~mxStopRelay.value;
  OSCdef(\mxSourceMeterRelay, { |msg| relay.sendMsg(*msg) }, '/mx/source-meter', s.addr);
  OSCdef(\mxOutputMeterRelay, { |msg| relay.sendMsg(*msg) }, '/mx/output-meter', s.addr);
  OSCdef(\mxFailCapture, { |msg| ~mxLastFail = msg.drop(1).join(" ") }, '/fail', s.addr);
  ~mxRuntimeRoutine = Routine({
    loop {
      s.status;
      0.25.wait;
      if([s.avgCPU, s.peakCPU, s.numUGens, s.numSynths, s.numGroups, s.sampleRate, s.actualSampleRate, s.latency].every { |v| v.isNumber }) {
        relay.sendMsg('/mx/runtime', s.avgCPU, s.peakCPU, s.numSynths, s.numUGens, s.numGroups,
          s.options.sampleRate ? s.sampleRate, s.actualSampleRate, s.options.blockSize ? 64,
          s.options.hardwareBufferSize ? -1, s.latency * 1000, ~mxLastFail);
      };
      0.75.wait;
    }
  }).play(SystemClock);
};
ShutDown.add({ ~mxStopRelay.value });

s.waitForBoot({
  ~mxInit.(s);
  ~mxStartRelay.value;
  ~mxBootState = 1;
  "MX-ENGINE-READY".postln;
}, onFailure: {
  ~mxBootState = -1;
  "MX-ENGINE-FAIL démarrage du serveur impossible".postln;
});
