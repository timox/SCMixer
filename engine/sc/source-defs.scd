/*
 * SynthDefs de source par largeur de canaux.
 *
 * Chargé par graph.scd. ~mxEnsureWidth.(w) construit et ajoute sur ~mxServer
 * les onze SynthDefs d'une largeur w, puis attend leur chargement
 * (server.sync) : l'appel doit donc venir d'une Routine. Une largeur déjà
 * construite n'est pas reconstruite (retour false ; true après construction).
 *
 * Chaque étage lit et réécrit (ReplaceOut) le bus privé de w canaux de la
 * source ; seul \mx_mix_<w> écrit vers les bus stéréo Master et Cue.
 * Correspondances avec le contrat :
 *   EQ 0..1 -> (v * 2 - 1) * 12 dB ; fréquence 0..1 -> 20 * 1000.pow(v) Hz
 *   (RHPF au moins 40 Hz) ; q -> rq = 1 / q ; ratio -> slopeAbove = 1 / ratio ;
 *   makeupDb -> makeupDb.dbamp ; balance 0..1 -> pan = balance * 2 - 1.
 */

// windowSize de PitchShift (s) : source de vérité côté sclang ; PITCH_WINDOW_SECONDS (server-options.js)
// en dérive le dimensionnement de memSize, l'égalité est vérifiée par tests/server-options.test.js.
~mxPitchWindowSeconds = 0.2;

~mxDefName = { |kind, width| ("mx_" ++ kind ++ "_" ++ width).asSymbol };

// Compression liée : un seul signal de contrôle (maximum des valeurs absolues) pour tous les canaux.
~mxLinkedControl = { |sig, width| if(width > 1) { sig.abs.reduce(\max) } { sig } };

~mxBuildSourceDefs = { |w|
  var name = { |kind| ~mxDefName.(kind, w) };
  var linked = ~mxLinkedControl;
  [
    SynthDef(name.(\in), { |bus, firstChannel=1, meterId=0, gain=1,
      compThresholdDb=(-20), compRatio=4, compAttackMs=10, compReleaseMs=100,
      compMakeupDb=0, compBypass=1, controlLag=0.05|
      var sig = SoundIn.ar((firstChannel - 1) + (0..w-1));
      var compressed = Compander.ar(sig, linked.(sig, w), compThresholdDb.dbamp, 1.0,
        compRatio.reciprocal, compAttackMs / 1000, compReleaseMs / 1000) * compMakeupDb.dbamp;
      sig = Select.ar(compBypass, [compressed, sig]);
      sig = sig * gain.lag(controlLag);
      SendPeakRMS.kr(sig, 10, 0.25, '/mx/source-meter', meterId);
      ReplaceOut.ar(bus, sig);
    }),

    SynthDef(name.(\eq), { |bus, eqLow=0.5, eqMid=0.5, eqHigh=0.5, controlLag=0.05|
      var sig = In.ar(bus, w);
      var lowDb = (eqLow.lag(controlLag) * 2 - 1) * 12;
      var midDb = (eqMid.lag(controlLag) * 2 - 1) * 12;
      var highDb = (eqHigh.lag(controlLag) * 2 - 1) * 12;
      sig = BLowShelf.ar(sig, 80, 0.5, lowDb);
      sig = BPeakEQ.ar(sig, 1000, 0.7, midDb);
      sig = BHiShelf.ar(sig, 8000, 0.5, highDb);
      ReplaceOut.ar(bus, sig);
    }),

    // EQ neutre : graphe distinct, sans UGen d'égalisation.
    SynthDef(name.(\eqdirect), { |bus|
      ReplaceOut.ar(bus, In.ar(bus, w));
    }),

    SynthDef(name.(\hp), { |bus, enabled=0, model=0, freq=0, q=1, mul=1, add=0, controlLag=0.05|
      var dry = In.ar(bus, w);
      var cutoff = freq.lag(controlLag).linexp(0, 1, 20, 20000);
      var rq = q.lag(controlLag).reciprocal;
      var filtered = SelectX.ar(model.lag(controlLag), [
        BHiPass.ar(dry, cutoff, rq), RHPF.ar(dry, cutoff.max(40), rq)
      ]) * mul.lag(controlLag) + add.lag(controlLag);
      // L'interpolation linéaire garde l'unité sur un matériau corrélé pendant la bascule.
      ReplaceOut.ar(bus, dry + ((filtered - dry) * enabled.lag(controlLag)));
    }),

    SynthDef(name.(\hp4), { |bus, enabled=0, freq=0, q=1, mul=1, add=0, controlLag=0.05|
      var dry = In.ar(bus, w);
      var cutoff = freq.lag(controlLag).linexp(0, 1, 20, 20000);
      var filtered = BHiPass4.ar(dry, cutoff, q.lag(controlLag).reciprocal)
        * mul.lag(controlLag) + add.lag(controlLag);
      ReplaceOut.ar(bus, dry + ((filtered - dry) * enabled.lag(controlLag)));
    }),

    SynthDef(name.(\lp), { |bus, enabled=0, model=0, freq=1, q=1, mul=1, add=0, controlLag=0.05|
      var dry = In.ar(bus, w);
      var cutoff = freq.lag(controlLag).linexp(0, 1, 20, 20000);
      var rq = q.lag(controlLag).reciprocal;
      var filtered = SelectX.ar(model.lag(controlLag), [
        BLowPass.ar(dry, cutoff, rq), RLPF.ar(dry, cutoff, rq)
      ]) * mul.lag(controlLag) + add.lag(controlLag);
      ReplaceOut.ar(bus, dry + ((filtered - dry) * enabled.lag(controlLag)));
    }),

    SynthDef(name.(\lp4), { |bus, enabled=0, freq=1, q=1, mul=1, add=0, controlLag=0.05|
      var dry = In.ar(bus, w);
      var cutoff = freq.lag(controlLag).linexp(0, 1, 20, 20000);
      var filtered = BLowPass4.ar(dry, cutoff, q.lag(controlLag).reciprocal)
        * mul.lag(controlLag) + add.lag(controlLag);
      ReplaceOut.ar(bus, dry + ((filtered - dry) * enabled.lag(controlLag)));
    }),

    SynthDef(name.(\lpmoog), { |bus, enabled=0, freq=1, gain=2, t_reset=0, mul=1, add=0, controlLag=0.05|
      var dry = In.ar(bus, w);
      var cutoff = freq.lag(controlLag).linexp(0, 1, 20, 20000);
      var filtered = MoogFF.ar(dry, cutoff, gain.lag(controlLag), t_reset)
        * mul.lag(controlLag) + add.lag(controlLag);
      ReplaceOut.ar(bus, dry + ((filtered - dry) * enabled.lag(controlLag)));
    }),

    SynthDef(name.(\pitch), { |bus, pitch=0, controlLag=0.05|
      var sig = In.ar(bus, w);
      var shifted = PitchShift.ar(sig, ~mxPitchWindowSeconds, pitch.lag(controlLag).midiratio, 0, 0.01);
      // PitchShift colore le signal même au rapport 1 : chemin direct à zéro demi-ton.
      ReplaceOut.ar(bus, XFade2.ar(sig, shifted, ((pitch.abs > 0).lag(controlLag) * 2) - 1));
    }),

    // Compresseur trois bandes ; chaque bande est liée sur l'ensemble des canaux.
    SynthDef(name.(\dyn), { |bus|
      var sig = In.ar(bus, w);
      var bands = [
        LPF.ar(LPF.ar(sig, 250), 250),
        LPF.ar(LPF.ar(HPF.ar(HPF.ar(sig, 250), 250), 4000), 4000),
        HPF.ar(HPF.ar(sig, 4000), 4000)
      ];
      var bypasses = List.new;
      var processed = [\low, \mid, \high].collect { |band, index|
        var prefix = band.asString;
        var input = bands[index];
        var threshold = (prefix ++ "ThresholdDb").asSymbol.kr(-20);
        var ratio = (prefix ++ "Ratio").asSymbol.kr(4);
        var attack = (prefix ++ "AttackMs").asSymbol.kr(10);
        var release = (prefix ++ "ReleaseMs").asSymbol.kr(100);
        var makeup = (prefix ++ "MakeupDb").asSymbol.kr(0);
        var bypass = (prefix ++ "Bypass").asSymbol.kr(1);
        var compressed = Compander.ar(input, linked.(input, w), threshold.dbamp, 1.0,
          ratio.reciprocal, attack / 1000, release / 1000) * makeup.dbamp;
        bypasses.add(bypass);
        Select.ar(bypass, [compressed, input])
      };
      // Toutes bandes contournées : passage direct, sans coloration du filtre de répartition.
      ReplaceOut.ar(bus, Select.ar(bypasses[0] * bypasses[1] * bypasses[2], [processed.sum, sig]));
    }),

    SynthDef(name.(\mix), { |bus, out, cueOut, volume=1, cueLevel=0, mute=0, pan=0, controlLag=0.05|
      var input = In.ar(bus, w);
      var level = volume.lag(controlLag) * (1 - mute.lag(controlLag));
      var position = pan.lag(controlLag);
      var stereo = case
        { w == 1 } { Pan2.ar(input * level, position) }
        { w == 2 } { Balance2.ar(input[0] * level, input[1] * level, position) }
        { true } { var spread = Splay.ar(input) * level; Balance2.ar(spread[0], spread[1], position) };
      Out.ar(out, stereo);
      Out.ar(cueOut, stereo * cueLevel.lag(controlLag));
    })
  ]
};


// Vérifie côté serveur qu'un SynthDef est chargé : /s_new, /n_query et /n_free dans un seul bundle sans
// horodatage (le Synth n'exécute aucun bloc). /d_recv et /d_load échouent sans réponse /fail
// (scsynth n'écrit que « exception in GraphDef_Recv » sur sa sortie) et /sync ne signale pas cet échec :
// seule l'existence du nœud créé prouve que le SynthDef est chargé (Server-Command-Reference :
// /d_recv, /s_new, /n_query ; /s_new d'un SynthDef absent répond /fail). À appeler depuis une Routine.
// `timeout` (secondes) est obligatoire : ~mxSynthDefTimeout, jeton __MX_SYNTHDEF_TIMEOUT__ d'engine.scd
// (SYNTHDEF_TIMEOUT_SECONDS dans server-options.js). Sans réponse du serveur dans ce délai, une erreur
// explicite est levée (ce n'est pas « SynthDef absent »).
~mxSynthDefLoaded = { |server, name, timeout|
  var found = false, answered = false, cond = Condition.new, nodeId, info, fail;
  if(timeout.isNumber.not) { Error("~mxSynthDefLoaded : délai d'attente non défini (~mxSynthDefTimeout)").throw };
  nodeId = server.nextNodeID;
  info = OSCFunc({ |msg| if(msg[1] == nodeId) { found = true; answered = true; cond.test = true; cond.signal } }, '/n_info', server.addr);
  fail = OSCFunc({ |msg| if(msg[1] == '/n_query') { answered = true; cond.test = true; cond.signal } }, '/fail', server.addr);
  server.sendBundle(nil, ['/s_new', name, nodeId, 1, server.defaultGroup.nodeID], ['/n_query', nodeId], ['/n_free', nodeId]);
  SystemClock.sched(timeout, { cond.test = true; cond.signal; nil });
  cond.wait;
  info.free;
  fail.free;
  if(answered.not) {
    Error("Délai de " ++ timeout ++ " s dépassé : aucune réponse de scsynth à la vérification du SynthDef " ++ name).throw;
  };
  server.sync;
  found
};

~mxEnsureWidth = { |w|
  var defs, missing;
  if(w.isInteger.not or: { w < 1 } or: { w > 256 }) { Error("Largeur invalide : " ++ w).throw };
  if(~mxBuiltWidths.includes(w)) {
    false
  } {
    // Construction (bloque sclang : environ 9 s pour w = 256, mesuré) puis /d_recv ou /d_load,
    // asynchrones : /sync (Server-Command-Reference) attend leur fin. Le chargement est ensuite
    // vérifié côté serveur ; une largeur n'est marquée construite que si tous ses SynthDefs existent.
    defs = ~mxBuildSourceDefs.(w);
    defs.do { |def| def.add };
    ~mxServer.sync;
    missing = defs.reject { |def| ~mxSynthDefLoaded.(~mxServer, def.name, ~mxSynthDefTimeout) };
    if(missing.notEmpty) {
      Error("Échec serveur à la création des SynthDefs de largeur " ++ w ++ " : "
        ++ missing.collect { |def| def.name }.join(", ") ++ " non chargés (voir la sortie de scsynth)").throw;
    };
    ~mxBuiltWidths.add(w);
    true
  }
};
