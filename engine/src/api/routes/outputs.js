import { route } from '../async-route.js';
import { ApiError } from '../../contract/errors.js';
import { assertModelsAvailable } from '../../contract/models.js';
import { OUTPUT_STAGES } from '../../contract/schemas.js';
import { setOutputStage, copyMasterToCue } from '../../session/session-model.js';
import { setOutputStageCode } from '../../sc/commands.js';
import { outputGraph } from '../../contract/chains.js';

function checkOutput(name) {
  if (name !== 'master' && name !== 'cue') throw new ApiError('NOT_FOUND', 404, `Sortie inconnue : ${name}.`);
  return name;
}

function checkStage(list, stage, what) {
  if (!list.includes(stage)) throw new ApiError('NOT_FOUND', 404, `${what} inconnu : ${stage}.`);
}

export function registerOutputRoutes(api, engine) {
  // Route littérale avant la route à paramètres `:output/:stage`.
  api.post('/outputs/cue/copy-master', route(async (req, res) => {
    const session = await engine.mutate((current) => {
      const next = copyMasterToCue(current);
      assertModelsAvailable({ cue: next.outputs.cue }, engine.state().models);
      const code = OUTPUT_STAGES.map((stage) => setOutputStageCode('cue', stage, next.outputs.cue[stage])).join('; ');
      return { session: next, code };
    });
    res.json(session.outputs.cue);
  }));

  api.put('/outputs/:output/:stage', route(async (req, res) => {
    const { output, stage } = req.params;
    checkOutput(output);
    checkStage(OUTPUT_STAGES, stage, 'Étage de sortie');
    const session = await engine.mutate((current) => {
      const next = setOutputStage(current, output, stage, req.body);
      if (stage === 'compressor') assertModelsAvailable({ [output]: next.outputs[output] }, engine.state().models);
      return { session: next, code: setOutputStageCode(output, stage, next.outputs[output][stage]) };
    });
    res.json(session.outputs[output]);
  }));

  api.get('/outputs/:output/processing-graph', route((req, res) => {
    const output = engine.session().outputs[checkOutput(req.params.output)];
    res.json(outputGraph(output, engine.state().models));
  }));
}
