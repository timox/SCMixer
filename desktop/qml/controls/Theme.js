.pragma library
// Palette et typographie de l'interface (maquette docs/maquettes/qt-desktop/Maquette.qml).

var bg = "#16181c";
var panel = "#1f2228";
var panel2 = "#272b33";
var line = "#343944";
var text = "#d9dde4";
var dim = "#8a919e";
var accent = "#5aa9e6";
var ok = "#6cc08b";
var warn = "#e0b354";
var mute = "#d9645a";
var meterBg = "#0f1114";

var fontSmall = 10;
var fontNormal = 12;

// Texte d'une valeur avec son unité : précision selon l'ordre de grandeur.
function formatValue(value, unit, step) {
    if (value === undefined || value === null || isNaN(value))
        return "";
    var digits = step >= 1 ? 0 : (Math.abs(value) >= 100 ? 0 : (Math.abs(value) >= 10 ? 1 : 2));
    var s = Number(value).toFixed(digits);
    if (unit === "Hz" && Math.abs(value) >= 1000)
        s = (value / 1000).toFixed(2) + " k";
    return unit ? s + " " + unit : s;
}
