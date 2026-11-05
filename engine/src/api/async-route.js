/** Enveloppe un gestionnaire asynchrone : toute erreur est transmise au gestionnaire d'erreurs Express. */
export const route = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next);
};
