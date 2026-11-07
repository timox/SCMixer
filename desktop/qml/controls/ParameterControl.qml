import QtQuick
import "Theme.js" as Theme
import "Contract.js" as Contract

// Contrôle d'un paramètre, construit depuis son descripteur (GET /api/parameters) :
// nombre ou entier -> potentiomètre, booléen -> bouton, liste -> sélecteur de modèle.
// La valeur affichée est la grandeur jouée par le moteur lorsque le descripteur publie une conversion
// (display) ; stageValue fournit les champs de référence (minHz, maxHz, rangeDb).
// previewChanged(key, active, value) suit le glissement d'un potentiomètre (aperçu des graphes).
Item {
    id: control
    property var descriptor: ({})
    property var confirmedValue
    property var stageValue: ({})
    property var unavailable: []
    property bool dense: false
    signal edited(var value)
    signal previewChanged(string key, bool active, var value)

    readonly property string key: descriptor.key || ""
    objectName: "param-" + key
    implicitWidth: loader.item ? loader.item.implicitWidth : 0
    implicitHeight: loader.item ? loader.item.implicitHeight : 0

    function format(v) {
        var p = Contract.played(control.descriptor, control.stageValue, v);
        if (p)
            return Theme.formatValue(p.value, p.unit, 0);
        return Theme.formatValue(v, control.descriptor.unit || "", control.descriptor.step || 0);
    }

    Loader {
        id: loader
        sourceComponent: control.descriptor.type === "boolean" ? toggle
                       : control.descriptor.type === "enum" ? selector
                       : knob
    }

    Component {
        id: knob
        Knob {
            enabled: control.enabled
            dense: control.dense
            label: control.descriptor.label || control.key
            hint: control.descriptor.description || ""
            from: control.descriptor.min
            to: control.descriptor.max
            stepSize: control.descriptor.step || 0
            defaultValue: control.descriptor["default"]
            unit: control.descriptor.unit || ""
            scale: control.descriptor.scale || "linear"
            formatter: control.format
            confirmedValue: Number(control.confirmedValue)
            onMoved: function (value) { control.edited(value) }
            onDraggingChanged: control.previewChanged(control.key, dragging, dragValue)
            onDragValueChanged: if (dragging) control.previewChanged(control.key, true, dragValue)
        }
    }
    Component {
        id: toggle
        Toggle {
            enabled: control.enabled
            label: control.descriptor.label || control.key
            hint: control.descriptor.description || ""
            checked: control.confirmedValue === true
            onToggled: function (value) { control.edited(value) }
        }
    }
    Component {
        id: selector
        ModelSelector {
            enabled: control.enabled
            label: control.descriptor.label || control.key
            options: control.descriptor.options || []
            optionInfo: control.descriptor.optionInfo || []
            unavailable: control.unavailable
            confirmedValue: String(control.confirmedValue)
            onSelected: function (value) { control.edited(value) }
        }
    }

    // Accès pour les tests et les panneaux : contrôle effectivement créé.
    readonly property Item editor: loader.item
}
