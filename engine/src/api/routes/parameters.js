import { route } from '../async-route.js';
import { buildParameterCatalog } from '../../contract/descriptors.js';

/** Catalogue contractuel avec les seuls modèles de compresseur chargés par le moteur. */
export function registerParameterRoutes(api, engine) {
  api.get('/parameters', route((req, res) => res.json(buildParameterCatalog(engine.state().models))));
}
