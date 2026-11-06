/*
 * Enregistrement WAV de la sortie Master (docs/superpowers/specs/2026-11-06-enregistrement-master-design.md).
 *
 * Point de captation : bus matériel 0/1, c'est-à-dire ce qui part vers la carte sur Master. Le synthé
 * \mx_record tourne dans ~mxRecGroup, placé après ~mxOutputGroup : après l'écrivain de sortie Master et
 * après le moniteur du banc EQ. Pause : le synthé est suspendu (rien n'est écrit) ; reprise : il repart
 * dans le même fichier. Arrêt : synthé libéré, puis tampon fermé (en-tête définitif) et libéré.
 *
 * Les fonctions sont appelées par la file de commandes du service (Routine) : server.sync y est permis.
 * Réponses texte décodées par src/runtime/recorder.js :
 *   ~mxRecStart.(path, sampleFormat) -> "recording|<sampleRate>", "refused|RECORDING_ACTIVE", "refused|OPEN_FAILED"
 *   ~mxRecPause.()  -> "paused" ou "refused|NOT_RECORDING"
 *   ~mxRecResume.() -> "recording" ou "refused|NOT_PAUSED"
 *   ~mxRecStop.()   -> "stopped" ou "refused|NOT_ACTIVE"
 *   ~mxRecState.()  -> "stopped", "recording" ou "paused"
 */
~mxRec = nil;
~mxRecGroup = nil;
~mxRecDef = SynthDef(\mx_record, { DiskOut.ar(\buf.kr(0), In.ar(\in.kr(0), 2)) });

~mxRecState = { if(~mxRec.isNil) { "stopped" } { ~mxRec[\state].asString } };

~mxRecStart = { |path, sampleFormat|
  var server = ~mxServer, buffer, synth;
  if(~mxRec.notNil) { "refused|RECORDING_ACTIVE" } {
    if(~mxRecGroup.isNil) {
      ~mxRecDef.add;
      ~mxRecGroup = Group.after(~mxOutputGroup);
      server.sync;
    };
    buffer = Buffer.alloc(server, 65536, 2);
    server.sync;
    buffer.write(path, "wav", sampleFormat, 0, 0, true);
    server.sync;
    if(File.exists(path).not) {
      buffer.free;
      server.sync;
      "refused|OPEN_FAILED"
    } {
      synth = Synth.tail(~mxRecGroup, \mx_record, [\buf, buffer.bufnum, \in, 0]);
      server.sync;
      ~mxRec = (state: \recording, buffer: buffer, synth: synth, path: path);
      "recording|" ++ server.sampleRate.asInteger
    }
  }
};

~mxRecPause = {
  if(~mxRec.isNil or: { ~mxRec[\state] != \recording }) { "refused|NOT_RECORDING" } {
    ~mxRec[\synth].run(false);
    ~mxServer.sync;
    ~mxRec[\state] = \paused;
    "paused"
  }
};

~mxRecResume = {
  if(~mxRec.isNil or: { ~mxRec[\state] != \paused }) { "refused|NOT_PAUSED" } {
    ~mxRec[\synth].run(true);
    ~mxServer.sync;
    ~mxRec[\state] = \recording;
    "recording"
  }
};

~mxRecStop = {
  var rec = ~mxRec, server = ~mxServer;
  if(rec.isNil) { "refused|NOT_ACTIVE" } {
    rec[\synth].free;
    server.sync;
    rec[\buffer].close;
    server.sync;
    rec[\buffer].free;
    server.sync;
    ~mxRec = nil;
    "stopped"
  }
};
