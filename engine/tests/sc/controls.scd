/*
 * Introspection des SynthDefs du moteur, sans serveur (aucun boot, aucun port audio).
 *
 * Construit les SynthDefs de source (largeurs 1, 2 et 3) et de sortie (trois modèles de compresseur
 * et écrivain), puis écrit sur la sortie standard :
 *   MX-CTL <def> <contrôle> <défaut> <débit>         un contrôle de la SynthDef
 *   MX-UNUSED <def> <contrôle>                        contrôle sans consommateur dans le graphe
 *   MX-CONST <def> <UGen> <index d'entrée> <valeur>   constante en position d'argument d'un UGen audité
 *   MX-HIDDEN <def> <opérateur> <index> <valeur>      multiplicateur ou décalage numérique appliqué directement à la
 *                                                     sortie d'un filtre, d'un Compander, d'un PitchShift ou d'une
 *                                                     lecture (MulAdd ou BinaryOpUGen : mul/add cachés)
 * SynthDef \mx_hidden_bad : cas négatif volontaire (multiplicateur 0.8 et décalage 0.1 cachés) que le test JS doit voir.
 * puis "MX-TEST-OK". Les tests JS comparent ces lignes au contrat (tests/parameters.test.js).
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var audited = [\BLowShelf, \BPeakEQ, \BHiShelf, \BHiPass, \BLowPass, \BHiPass4, \BLowPass4, \RHPF, \RLPF,
  \MoogFF, \LPF, \HPF, \Compander, \PitchShift, \XFade2, \Pan2, \Balance2, \Clip, \Limiter, \Select,
  \VarLag, \LinExp, \DelayN, \MixetteFaustRMS, \SendPeakRMS, \Lag];
var sources = [\BLowShelf, \BPeakEQ, \BHiShelf, \BHiPass, \BLowPass, \BHiPass4, \BLowPass4, \RHPF, \RLPF,
  \MoogFF, \LPF, \HPF, \Compander, \PitchShift, \In, \MixetteFaustRMS];
var describe, fromSource;
~mxServer = nil;
(root +/+ "sc" +/+ "graph.scd").load;

fromSource = { |input|
  var source = if(input.isKindOf(OutputProxy)) { input.source } { input };
  source.isKindOf(UGen) and: { sources.includes(source.class.name) }
};

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
    // mul/add cachés : constante numérique combinée directement à la sortie d'un UGen à mul/add.
    if([\MulAdd, \BinaryOpUGen].includes(u.class.name) and: { u.inputs.any { |in| fromSource.(in) } }) {
      u.inputs.do { |in, i|
        if(in.isNumber) { ("MX-HIDDEN " ++ def.name ++ " " ++ u.class.name ++ "/" ++ u.operator ++ " " ++ i ++ " " ++ in).postln };
      };
    };
  };
};

[1, 2, 3].do { |w| ~mxBuildSourceDefs.(w).do { |def| describe.(def) } };
~mxBuildOutputDefs.(true).do { |def| describe.(def) };
describe.(~mxOutputWriterDef);
// Cas négatif : un * 0.8 et un décalage 0.1 cachés après un filtre.
describe.(SynthDef(\mx_hidden_bad, { Out.ar(0, BLowShelf.ar(In.ar(0), \f.kr(1000), 0.5, 0) * 0.8) }));
describe.(SynthDef(\mx_hidden_bad_add, { Out.ar(0, RLPF.ar(In.ar(0), \f.kr(1000), 0.5).madd(1, 0.1)) }));
"MX-TEST-OK".postln;
0.exit;
)
