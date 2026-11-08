/*
 * Enregistrement de la sortie Master sur un vrai scsynth.
 *
 * Serveur dédié \mxrec sur 127.0.0.1:57147, sortie MME (jamais ASIO, jamais TimoxVasio), sans entrée
 * matérielle. Une sinusoïde est jouée sur le bus matériel 0/1. Pour chaque précision (int16, int24, float) :
 * démarrage, refus d'un second démarrage, pause, reprise, arrêt ; le fichier WAV doit avoir 2 canaux, la
 * précision demandée, une durée hors pause et contenir le signal. Les synthés, bus et tampons sont libérés.
 * Verdict : "MX-TEST-OK" ou "MX-TEST-FAIL <raison>", puis 0.exit.
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var server = Server(\mxrec, NetAddr("127.0.0.1", 57147));
var done = false;
var finish, fail, check, probeBus, probeBuf;

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
probeBus = { var bus = Bus.audio(server, 2), index = bus.index; bus.free; index };
// Premier tampon libre : identique avant et après si chaque tampon d'enregistrement a été libéré.
probeBuf = { var b = Buffer.alloc(server, 1), n = b.bufnum; server.sync; b.free; server.sync; n };

SystemClock.sched(55, { fail.("délai dépassé dans le test sclang"); nil });

server.options.device = "MME : Mappeur de sons Microsoft - Output";
server.options.numInputBusChannels = 0;
server.options.numOutputBusChannels = 8;

~mxSynthDefTimeout = 5;
(root +/+ "sc" +/+ "graph.scd").load;
(root +/+ "sc" +/+ "recording.scd").load;

server.waitForBoot({
  try {
    var busTop, bufTop, synthsBefore, tone, dir;
    ("MX-TEST-SCSYNTH-PID " ++ server.pid).postln;
    ~mxInit.(server, 0);
    server.sync;
    SynthDef(\mx_test_tone, { Out.ar(0, SinOsc.ar(440, 0, 0.1) ! 2) }).add;
    server.sync;
    tone = Synth.tail(~mxOutputGroup, \mx_test_tone);
    server.sync;
    busTop = probeBus.value;
    bufTop = probeBuf.value;
    dir = Platform.defaultTempDir +/+ ("mx-rec-" ++ Date.getDate.stamp);
    File.mkdir(dir);

    check.(~mxRecState.value == "stopped", "état initial : " ++ ~mxRecState.value);
    [\int16, \int24, \float].do { |format|
      var path = (dir +/+ format ++ ".wav").replace("\\", "/");
      var reply, file, seconds, data, peak;
      reply = ~mxRecStart.(path, format.asString);
      check.(reply == ("recording|" ++ server.sampleRate.asInteger), "démarrage " ++ format ++ " : " ++ reply);
      check.(~mxRecStart.(path, format.asString) == "refused|RECORDING_ACTIVE", "second démarrage accepté");
      check.(~mxRecState.value == "recording", "état après démarrage");
      1.0.wait;
      check.(~mxRecPause.value == "paused", "pause");
      check.(~mxRecState.value == "paused", "état en pause");
      1.0.wait;
      check.(~mxRecResume.value == "recording", "reprise");
      0.5.wait;
      check.(~mxRecStop.value == "stopped", "arrêt");
      check.(~mxRecState.value == "stopped", "état après arrêt");

      file = SoundFile.openRead(path);
      check.(file.notNil, "fichier illisible : " ++ path);
      seconds = file.numFrames / file.sampleRate;
      check.(file.headerFormat == "WAV", "en-tête : " ++ file.headerFormat);
      check.(file.numChannels == 2, "canaux : " ++ file.numChannels);
      check.(file.sampleFormat == format.asString, "précision : " ++ file.sampleFormat);
      check.(seconds > 1.3 and: { seconds < 1.8 }, "durée hors pause : " ++ seconds);
      file.seek((file.numFrames / 2).asInteger);
      data = FloatArray.newClear(4096 * 2);
      file.readData(data);
      file.close;
      peak = data.abs.maxItem;
      check.(peak > 0.05, "signal absent du fichier : " ++ peak);
    };
    check.(~mxRecPause.value == "refused|NOT_RECORDING", "pause à l'arrêt acceptée");
    check.(~mxRecResume.value == "refused|NOT_PAUSED", "reprise à l'arrêt acceptée");
    check.(~mxRecStop.value == "refused|NOT_ACTIVE", "arrêt à l'arrêt accepté");
    check.(~mxRecStart.("Z:/inexistant/x/y.wav", "int24") == "refused|OPEN_FAILED", "ouverture impossible non signalée");

    tone.free;
    server.sync;
    check.(probeBus.value == busTop, "bus non libérés");
    check.(probeBuf.value == bufTop, "tampons d'enregistrement non libérés");
    finish.("MX-TEST-OK");
  } { |error|
    fail.(error.errorString);
  };
}, onFailure: { fail.("démarrage du serveur impossible") });
)
