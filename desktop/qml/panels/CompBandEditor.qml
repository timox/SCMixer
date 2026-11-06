import QtQuick
import QtQuick.Layouts
import "../controls"

// Une bande de compression (CompBand) : réglages et courbe statique.
StagePanel {
    id: editor
    property var curves: null
    CompCurve {
        width: 110
        height: 80
        points: editor.curves ? editor.curves.compressorCurve(editor.value, 81) : []
    }
}
