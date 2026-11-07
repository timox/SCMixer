.pragma library

function addDb(target, source, key) {
    if (!source || source.length === 0)
        return;
    for (var i = 0; i < target.length; ++i)
        target[i].db = Math.max(-120, target[i].db + source[i][key]);
}

function frequencyResponse(processing, isSource, curves, sampleRate, points, overrides) {
    if (!curves || sampleRate <= 0)
        return { mid: [], side: [] };

    var value = {};
    for (var stage in processing)
        value[stage] = processing[stage];
    for (var changedStage in overrides)
        value[changedStage] = overrides[changedStage];

    var filters = isSource ? curves.filterResponse(value.hp || ({}), value.lp || ({}), sampleRate, points) : [];
    var eq = curves.eqResponse(value.eq || ({}), sampleRate, points);
    var mid = [];
    for (var i = 0; i < eq.length; ++i)
        mid.push({ hz: eq[i].hz, db: 0 });

    if (isSource) {
        addDb(mid, filters, "db");
        addDb(mid, eq, "db");
        if (value.bandCompressor && value.bandCompressor.crossover)
            addDb(mid, curves.crossoverResponse(value.bandCompressor.crossover, sampleRate, points), "sum");
        return { mid: mid, side: [] };
    }

    addDb(mid, eq, "db");
    if (value.infraHpf)
        addDb(mid, curves.highPassResponse(value.infraHpf, sampleRate, points), "db");
    var side = mid.map(function (point) { return { hz: point.hz, db: point.db }; });
    if (value.sideHpf)
        addDb(side, curves.highPassResponse(value.sideHpf, sampleRate, points), "db");
    return { mid: mid, side: side };
}
