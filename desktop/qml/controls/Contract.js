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

// Le champ s'applique-t-il ? appliesTo du descripteur : largeur de la source (context.width) et modèle
// de l'étage (value.model).
function applies(descriptor, value, context) {
    var a = descriptor.appliesTo;
    if (!a)
        return true;
    if (a.width && context) {
        var w = context.width;
        if (w !== undefined && ((a.width.min !== undefined && w < a.width.min) || (a.width.max !== undefined && w > a.width.max)))
            return false;
    }
    if (a.model && value && a.model.indexOf(value.model) < 0)
        return false;
    return true;
}

// Grandeur jouée par le moteur, selon la conversion `display` publiée par l'API pour ce champ ;
// null si le champ n'en déclare pas. stageValue : objet confirmé de l'étage (champs de référence).
function played(descriptor, stageValue, v) {
    var d = descriptor ? descriptor.display : null;
    if (!d || !stageValue)
        return null;
    if (d.kind === "linexp") {
        var lo = Number(stageValue[d.minField]), hi = Number(stageValue[d.maxField]);
        return { value: lo * Math.pow(hi / lo, v), unit: d.unit };
    }
    if (d.kind === "bipolar")
        return { value: (v * 2 - 1) * Number(stageValue[d.rangeField]), unit: d.unit };
    return null;
}

// L'étage agit-il ? state publié par le catalogue (champ et valeur active) ; absent : toujours actif.
function active(stageDescriptor, value) {
    var s = stageDescriptor ? stageDescriptor.state : null;
    if (!s || !value)
        return true;
    return value[s.field] === s.active;
}
