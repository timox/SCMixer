import { route } from '../async-route.js';
import { ApiError } from '../../contract/errors.js';
import { assertModelsAvailable } from '../../contract/models.js';
import { OUTPUT_STAGES } from '../../contract/schemas.js';
import {
  setOutputStage, copyMasterToCue, resetOutputStage, resetOutput, setOutputChannels,
} from '../../session/session-model.js';
import { setOutputStageCode, outputCode, outputChannelsCode } from '../../sc/commands.js';
import { outputGraph } from '../../contract/chains.js';

function checkOutput(name) {
  if (name !== 'master' && name !== 'cue') throw new ApiError('NOT_FOUND', 404, `Sortie inconnue : ${name}.`);
  return name;
}

function checkStage(list, stage, what) {
  if (!list.includes(stage)) throw new ApiError('NOT_FOUND', 404, `${what} inconnu : ${stage}.`);
}

export function registerOutputRoutes(api, engine) {
  api.put('/outputs/:output/channels', route(async (req, res) => {
    const output = checkOutput(req.params.output);
    const session = await engine.mutate((current) => {
      const next = setOutputChannels(current, output, req.body?.firstChannel);
      return { session: next, code: outputChannelsCode(output, next.outputChannels[output]) };
    });
    res.json({ firstChannel: session.outputChannels[output] });
  }));
  // Route littérale avant la route à paramètres `:output/:stage`.
  api.post('/outputs/cue/copy-master', route(async (req, res) => {
    const session = await engine.mutate((current) => {
      const next = copyMasterToCue(current);
      assertModelsAvailable({ cue: next.outputs.cue }, engine.state().models);
      return { session: next, code: outputCode('cue', next.outputs.cue) };
    });
    res.json(session.outputs.cue);
  }));

  api.post('/outputs/:output/reset', route(async (req, res) => {
    const output = checkOutput(req.params.output);
    const session = await engine.mutate((current) => {
      const next = resetOutput(current, output);
      assertModelsAvailable({ [output]: next.outputs[output] }, engine.state().models);
      return { session: next, code: outputCode(output, next.outputs[output]) };
    });
    res.json(session.outputs[output]);
  }));

  api.post('/outputs/:output/:stage/reset', route(async (req, res) => {
    const { output, stage } = req.params;
    checkOutput(output);
    checkStage(OUTPUT_STAGES, stage, 'Étage de sortie');
    const session = await engine.mutate((current) => {
      const next = resetOutputStage(current, output, stage);
      if (stage === 'compressor') assertModelsAvailable({ [output]: next.outputs[output] }, engine.state().models);
      return { session: next, code: setOutputStageCode(output, stage, next.outputs[output][stage]) };
    });
    res.json(session.outputs[output]);
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
