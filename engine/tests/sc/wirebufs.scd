/*
 * Mesure du nombre maximal d'interconnexions audio vivantes (numWireBufs) par SynthDef.
 * Aucun serveur n'est démarré : seuls les graphes d'UGens produits par sclang sont analysés.
 *
 * Méthode (borne supérieure, sans partage de tampon) : on parcourt def.children dans l'ordre
 * d'exécution ; une sortie audio est vivante de sa création jusqu'à son dernier consommateur.
 * Le maximum du nombre de sorties vivantes majore le nombre de tampons d'interconnexion que
 * scsynth doit fournir (ServerOptions : numWireBufs « sets the limit of complexity of SynthDefs »).
 * Sortie : une ligne "MX-WIRE <largeur> <nom de def> <maximum>" par SynthDef (largeur 0 pour les
 * SynthDefs de sortie), puis "MX-TEST-OK".
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var live = { |def|
  var last = IdentityDictionary.new, maxLive = 0, cur = 0;
  var source = { |in| if(in.isKindOf(OutputProxy)) { in.source } { in } };
  def.children.do { |u, i|
    u.inputs.do { |in| var src = source.(in); if(src.isKindOf(UGen)) { last[src] = i } };
  };
  def.children.do { |u, i|
    if(u.rate == \audio) { cur = cur + u.numOutputs };
    maxLive = max(maxLive, cur);
    u.inputs.do { |in|
      var src = source.(in);
      if(src.isKindOf(UGen) and: { src.rate == \audio and: { last[src] == i } }) {
        cur = cur - src.numOutputs;
        last[src] = -1;
      };
    };
  };
  maxLive
};
~mxServer = nil;
(root +/+ "sc" +/+ "graph.scd").load;
[1, 2, 3, 8, 64, 256].do { |w|
  ~mxBuildSourceDefs.(w).do { |def| ("MX-WIRE " ++ w ++ " " ++ def.name ++ " " ++ live.(def)).postln };
};
// Sorties : modèles Compander et CompanderD (même graphe que dans ~mxInit) et écrivain matériel.
[
  ~mxOutputDef.(\mx_output_compander, { |sig, threshold, below, above, attack, release, mul, add|
    Compander.ar(sig, sig, threshold.dbamp, below, above, attack / 1000, release / 1000, mul, add)
  }),
  ~mxOutputDef.(\mx_output_companderD, { |sig, threshold, below, above, attack, release, mul, add|
    Compander.ar(DelayN.ar(sig, ~mxCompanderDMaxDelay, (attack / 1000).min(~mxCompanderDMaxDelay)), sig,
      threshold.dbamp, below, above, attack / 1000, release / 1000).madd(mul, add)
  }),
  ~mxOutputWriterDef
].do { |def| ("MX-WIRE 0 " ++ def.name ++ " " ++ live.(def)).postln };
"MX-TEST-OK".postln;
0.exit;
)
