import { route } from '../async-route.js';
import { buildParameterCatalog } from '../../contract/descriptors.js';

/** Catalogue statique : publié moteur arrêté, sans lecture de la session. */
export function registerParameterRoutes(api) {
  const catalog = buildParameterCatalog();
  api.get('/parameters', route((req, res) => res.json(catalog)));
}
