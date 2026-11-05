/*
 * SynthDefs de source par largeur de canaux.
 *
 * Chargé par graph.scd. ~mxEnsureWidth.(w) construit et ajoute sur ~mxServer
 * les treize SynthDefs d'une largeur w, puis attend leur chargement
 * (server.sync) : l'appel doit donc venir d'une Routine. Une largeur déjà
 * construite n'est pas reconstruite (retour false ; true après construction).
 *
 * Chaque étage lit et réécrit (ReplaceOut) le bus privé de w canaux de la
 * source ; seul \mx_mix_<w> écrit vers les bus stéréo Master et Cue.
 * Familles : in, eq, eqdirect (EQ neutre, sans UGen), hp<Modèle> (BHiPass, RHPF,
 * BHiPass4), lp<Modèle> (BLowPass, RLPF, BLowPass4, MoogFF), pitch, dyn, mix.
 *
 * Noms des contrôles (règle unique, voir l'en-tête de graph.scd) : le nom du
 * contrôle est le nom du champ du contrat ; une SynthDef qui porte plusieurs
 * groupes du contrat préfixe le champ par le groupe (<groupe><Champ>) : \in
 * (input, inputCompressor) et \dyn (low, mid, high, crossover). Les
 * conversions se font dans les SynthDefs :
 *   EQ 0..1 -> (v * 2 - 1) * rangeDb dB ; fréquence 0..1 -> linexp minHz..maxHz
 *   (RHPF au moins floorHz) ; q -> rq = 1 / q ; thresholdDb -> thresh = dbamp ;
 *   attackMs, releaseMs -> clampTime, relaxTime = ms / 1000 ;
 *   semitones -> pitchRatio = midiratio ; balance 0..1 -> pos = balance * 2 - 1.
 * Chaque étage porte son controlLag (Lag.kr de ses contrôles continus ; 0 =
 * application immédiate). windowSize de PitchShift est un argument fixé à la
 * création (PitchShift.schelp : « cannot be modulated ») : il n'est pas lissé
 * et son changement recrée le Synth (graph.scd).
 * Contrôles hors contrat : câblage (bus, out, cueOut, firstChannel, meterId) et
 * retrait de source (fadeGate, fadeSeconds de \mx_mix_<w>, voir graph.scd).
 */

// windowSize maximal de PitchShift (s) : source de vérité côté sclang ; PITCH_WINDOW_MAX_SECONDS
// (schemas.js, repris par server-options.js pour memSize) en dérive la plage du contrat, l'égalité est
// vérifiée par tests/single-source.test.js. La valeur effective du contrôle est bornée à ce maximum.
~mxPitchWindowMaxSeconds = 0.2;

~mxDefName = { |kind, width| ("mx_" ++ kind ++ "_" ++ width).asSymbol };

// Nom d'un contrôle : champ seul, ou <groupe><Champ> pour une SynthDef à plusieurs groupes.
~mxName = { |group, field|
  var f = field.asString;
  if(group.isNil) { f.asSymbol } { (group.asString ++ f[0].toUpper ++ f.drop(1)).asSymbol }
};
~mxCtl = { |group, field, default| ~mxName.(group, field).kr(default) };
// Contrôle continu lissé par le controlLag de son groupe (Lag.kr ; lagTime 0 = valeur directe).
~mxLg = { |group, field, default| ~mxCtl.(group, field, default).lag(~mxCtl.(group, \controlLag, 0)) };

// Compression liée : un seul signal de contrôle (maximum des valeurs absolues) pour tous les canaux.
~mxLinkedControl = { |sig, width| if(width > 1) { sig.abs.reduce(\max) } { sig } };

// Chaîne EQ trois bandes (plateau grave, cloche, plateau aigu) commune aux sources et aux sorties.
~mxEqChain = { |sig, group, lowFreq|
  var lg = { |field, default| ~mxLg.(group, field, default) };
  var range = lg.(\rangeDb, 12);
  var lowDb = (lg.(\low, 0.5) * 2 - 1) * range;
  var midDb = (lg.(\mid, 0.5) * 2 - 1) * range;
  var highDb = (lg.(\high, 0.5) * 2 - 1) * range;
  sig = BLowShelf.ar(sig, lg.(\lowFreq, lowFreq), lg.(\lowRs, 0.5), lowDb, lg.(\lowMul, 1), lg.(\lowAdd, 0));
  sig = BPeakEQ.ar(sig, lg.(\midFreq, 1000), lg.(\midRq, 0.7), midDb, lg.(\midMul, 1), lg.(\midAdd, 0));
  BHiShelf.ar(sig, lg.(\highFreq, 8000), lg.(\highRs, 0.5), highDb, lg.(\highMul, 1), lg.(\highAdd, 0))
};

// Compresseur (Compander) d'un groupe CompBand : retourne [signal après contournement, bypass].
~mxBandCompress = { |input, control, group|
  var lg = { |field, default| ~mxLg.(group, field, default) };
  var compressed = Compander.ar(input, control, lg.(\thresholdDb, -20).dbamp, lg.(\slopeBelow, 1),
    lg.(\slopeAbove, 0.25), lg.(\attackMs, 10) / 1000, lg.(\releaseMs, 100) / 1000,
    lg.(\mul, 1), lg.(\add, 0));
  var bypass = ~mxCtl.(group, \bypass, 1);
  [Select.ar(bypass, [compressed, input]), bypass]
};

// Étage passe-haut ou passe-bas : fréquence 0..1 -> linexp(minHz, maxHz), mélange sec/filtré par enabled.
// `filter.(dry, cutoff, lg)` construit le UGen du modèle ; lg.(champ, défaut) donne un contrôle lissé.
~mxPassDef = { |kind, w, freqDefault, filter|
  SynthDef(~mxDefName.(kind, w), {
    var bus = \bus.kr(0);
    var lg = { |field, default| ~mxLg.(nil, field, default) };
    var dry = In.ar(bus, w);
    var cutoff = lg.(\freq, freqDefault).linexp(0, 1, lg.(\minHz, 20), lg.(\maxHz, 20000));
    var filtered = filter.(dry, cutoff, lg);
    // L'interpolation linéaire garde l'unité sur un matériau corrélé pendant la bascule.
    ReplaceOut.ar(bus, dry + ((filtered - dry) * lg.(\enabled, 0)))
  })
};

~mxBuildSourceDefs = { |w|
  var name = { |kind| ~mxDefName.(kind, w) };
  var linked = ~mxLinkedControl;
  var pass = ~mxPassDef;
  [
    SynthDef(name.(\in), { |bus, firstChannel=1, meterId=0|
      var sig = SoundIn.ar((firstChannel - 1) + (0..w-1), ~mxLg.(\input, \mul, 1), ~mxLg.(\input, \add, 0));
      sig = ~mxBandCompress.(sig, linked.(sig, w), \inputCompressor)[0];
      sig = sig * ~mxLg.(\input, \gain, 1);
      SendPeakRMS.kr(sig, 10, 0.25, '/mx/source-meter', meterId);
      ReplaceOut.ar(bus, sig);
    }),

    SynthDef(name.(\eq), { |bus|
      ReplaceOut.ar(bus, ~mxEqChain.(In.ar(bus, w), nil, 80));
    }),

    // EQ neutre : graphe distinct, sans UGen d'égalisation.
    SynthDef(name.(\eqdirect), { |bus|
      ReplaceOut.ar(bus, In.ar(bus, w));
    }),

    pass.(\hpBHiPass, w, 0, { |dry, cutoff, lg|
      BHiPass.ar(dry, cutoff, lg.(\q, 1).reciprocal, lg.(\mul, 1), lg.(\add, 0))
    }),
    pass.(\hpRHPF, w, 0, { |dry, cutoff, lg|
      RHPF.ar(dry, cutoff.max(lg.(\floorHz, 40)), lg.(\q, 1).reciprocal, lg.(\mul, 1), lg.(\add, 0))
    }),
    pass.(\hpBHiPass4, w, 0, { |dry, cutoff, lg|
      BHiPass4.ar(dry, cutoff, lg.(\q, 1).reciprocal, lg.(\mul, 1), lg.(\add, 0))
    }),
    pass.(\lpBLowPass, w, 1, { |dry, cutoff, lg|
      BLowPass.ar(dry, cutoff, lg.(\q, 1).reciprocal, lg.(\mul, 1), lg.(\add, 0))
    }),
    pass.(\lpRLPF, w, 1, { |dry, cutoff, lg|
      RLPF.ar(dry, cutoff, lg.(\q, 1).reciprocal, lg.(\mul, 1), lg.(\add, 0))
    }),
    pass.(\lpBLowPass4, w, 1, { |dry, cutoff, lg|
      BLowPass4.ar(dry, cutoff, lg.(\q, 1).reciprocal, lg.(\mul, 1), lg.(\add, 0))
    }),
    // MoogFF : reset est un déclencheur (POST .../lp/reset-state), pas un champ du contrat.
    pass.(\lpMoogFF, w, 1, { |dry, cutoff, lg|
      MoogFF.ar(dry, cutoff, lg.(\gain, 2), \reset.tr(0), lg.(\mul, 1), lg.(\add, 0))
    }),

    SynthDef(name.(\pitch), { |bus|
      var sig = In.ar(bus, w);
      var lg = { |field, default| ~mxLg.(nil, field, default) };
      // windowSize : argument fixé à la création du UGen, donc ni lissé ni modulé ; borné au maximum du contrat.
      var window = ~mxCtl.(nil, \windowSize, ~mxPitchWindowMaxSeconds).min(~mxPitchWindowMaxSeconds);
      var shifted = PitchShift.ar(sig, window, lg.(\semitones, 0).midiratio, lg.(\pitchDispersion, 0),
        lg.(\timeDispersion, 0.01), lg.(\mul, 1), lg.(\add, 0));
      // PitchShift colore le signal même au rapport 1 : blend = -1 donne le chemin direct.
      ReplaceOut.ar(bus, XFade2.ar(sig, shifted, lg.(\blend, -1), lg.(\level, 1)));
    }),

    // Compresseur trois bandes ; chaque bande est liée sur l'ensemble des canaux. Répartition LR4 :
    // chaque cascade est formée de deux filtres identiques (mul et add propres à chaque UGen).
    SynthDef(name.(\dyn), { |bus|
      var sig = In.ar(bus, w);
      var cl = { |field, default| ~mxLg.(\crossover, field, default) };
      var lowMid = cl.(\lowMidFreq, 250);
      var midHigh = cl.(\midHighFreq, 4000);
      var cascade = { |filter, in, freq, id|
        2.do { |i|
          in = filter.ar(in, freq, cl.((id ++ (i + 1) ++ "Mul").asSymbol, 1), cl.((id ++ (i + 1) ++ "Add").asSymbol, 0));
        };
        in
      };
      var bands = [
        cascade.(LPF, sig, lowMid, "lowLp"),
        cascade.(LPF, cascade.(HPF, sig, lowMid, "midHp"), midHigh, "midLp"),
        cascade.(HPF, sig, midHigh, "highHp")
      ];
      var results = [\low, \mid, \high].collect { |group, index|
        ~mxBandCompress.(bands[index], linked.(bands[index], w), group)
      };
      var processed = results.collect { |r| r[0] };
      var allBypassed = results.collect { |r| r[1] }.inject(1, { |a, b| a * b });
      // Toutes bandes contournées : passage direct, sans coloration du filtre de répartition.
      ReplaceOut.ar(bus, Select.ar(allBypassed, [processed.sum, sig]));
    }),

    // Entrée et retrait : fadeGate 0 au départ (défaut), 1 envoyé par ~mxAddSource ; fadeGate 0 au retrait ; VarLag linéaire de
    // fadeSeconds, avant /n_free (graph.scd).
    SynthDef(name.(\mix), { |bus, out, cueOut, fadeGate=0, fadeSeconds=0.05|
      var input = In.ar(bus, w);
      var lg = { |field, default| ~mxLg.(nil, field, default) };
      var volume = lg.(\volume, 1);
      var cue = lg.(\cue, 0);
      var mute = lg.(\mute, 0);
      var position = lg.(\balance, 0.5) * 2 - 1;
      var panLevel = lg.(\panLevel, 1);
      var balanceLevel = lg.(\balanceLevel, 1);
      var spread = lg.(\spread, 1);
      var splayLevel = lg.(\splayLevel, 1);
      var center = lg.(\center, 0);
      var levelComp = lg.(\levelComp, 0.5);
      var level = volume * (1 - mute) * VarLag.kr(fadeGate, fadeSeconds, warp: \linear);
      var stereo = case
        { w == 1 } { Pan2.ar(input * level, position, panLevel) }
        { w == 2 } { Balance2.ar(input[0] * level, input[1] * level, position, balanceLevel) }
        { true } {
          var splayed = Splay.ar(input, spread, splayLevel, center, levelComp) * level;
          Balance2.ar(splayed[0], splayed[1], position, balanceLevel)
        };
      Out.ar(out, stereo);
      Out.ar(cueOut, stereo * cue);
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
