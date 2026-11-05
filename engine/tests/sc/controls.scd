/*
 * Introspection des SynthDefs du moteur, sans serveur (aucun boot, aucun port audio).
 *
 * Construit les SynthDefs de source (largeurs 1, 2 et 3) et de sortie (trois modèles de compresseur
 * et écrivain), puis écrit sur la sortie standard :
 *   MX-CTL <def> <contrôle> <défaut> <débit>         un contrôle de la SynthDef
 *   MX-UNUSED <def> <contrôle>                        contrôle sans consommateur dans le graphe
 *   MX-CONST <def> <UGen> <index d'entrée> <valeur>   constante en position d'argument d'un UGen audité
 * puis "MX-TEST-OK". Les tests JS comparent ces lignes au contrat (tests/parameters.test.js).
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var audited = [\BLowShelf, \BPeakEQ, \BHiShelf, \BHiPass, \BLowPass, \BHiPass4, \BLowPass4, \RHPF, \RLPF,
  \MoogFF, \LPF, \HPF, \Compander, \PitchShift, \XFade2, \Pan2, \Balance2, \Clip, \Limiter, \Select,
  \VarLag, \LinExp, \DelayN, \MixetteFaustRMS];
var describe;
~mxServer = nil;
(root +/+ "sc" +/+ "graph.scd").load;

describe = { |def|
  var used = IdentitySet.new;
  def.children.do { |u| u.inputs.do { |in| if(in.isKindOf(OutputProxy)) { used.add(in) } } };
  def.allControlNames.do { |cn|
    ("MX-CTL " ++ def.name ++ " " ++ cn.name ++ " " ++ cn.defaultValue.asCompileString ++ " " ++ cn.rate).postln;
  };
  // Un contrôle est utilisé si l'une des sorties de son UGen Control a un consommateur.
  def.children.select { |u| u.isKindOf(Control) }.do { |control|
    def.allControlNames.do { |cn|
      var k = cn.index - control.specialIndex;
      if(cn.index >= control.specialIndex and: { k < control.channels.size }) {
        if(used.includes(control.channels[k]).not) { ("MX-UNUSED " ++ def.name ++ " " ++ cn.name).postln };
      };
    };
  };
  def.children.do { |u|
    if(audited.includes(u.class.name)) {
      u.inputs.do { |in, i|
        if(in.isNumber) { ("MX-CONST " ++ def.name ++ " " ++ u.class.name ++ " " ++ i ++ " " ++ in).postln };
      };
    };
  };
};

[1, 2, 3].do { |w| ~mxBuildSourceDefs.(w).do { |def| describe.(def) } };
~mxBuildOutputDefs.(true).do { |def| describe.(def) };
describe.(~mxOutputWriterDef);
"MX-TEST-OK".postln;
0.exit;
)
