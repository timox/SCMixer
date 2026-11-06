.pragma library
// Lecture des réponses de l'API telles quelles (aucune traduction de champ).

// Descripteur d'un champ dans le catalogue GET /api/parameters : stage peut être "bandCompressor/low".
function field(parameters, scope, stage, key) {
    if (!parameters || !parameters[scope])
        return null;
    var parts = stage.split("/");
    var node = parameters[scope][parts[0]];
    if (node && parts.length > 1)
        node = node[parts[1]];
    if (!node || !node.fields)
        return null;
    for (var i = 0; i < node.fields.length; ++i)
        if (node.fields[i].key === key)
            return node.fields[i];
    return null;
}

function stage(parameters, scope, name) {
    if (!parameters || !parameters[scope])
        return { fields: [] };
    var parts = name.split("/");
    var node = parameters[scope][parts[0]];
    if (node && parts.length > 1)
        node = node[parts[1]];
    return node && node.fields ? node : { fields: [] };
}

// Copie de l'objet confirmé d'un étage avec un champ modifié : corps complet attendu par PUT.
function withField(value, key, v) {
    var body = {};
    for (var k in value)
        body[k] = value[k];
    body[key] = v;
    return body;
}
