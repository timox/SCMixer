import QtQuick

// Contrôle d'un paramètre, construit depuis son descripteur (GET /api/parameters) :
// nombre ou entier -> potentiomètre, booléen -> bouton, liste -> sélecteur de modèle.
Item {
    id: control
    property var descriptor: ({})
    property var confirmedValue
    property var unavailable: []
    signal edited(var value)

    readonly property string key: descriptor.key || ""
    objectName: "param-" + key
    implicitWidth: loader.item ? loader.item.implicitWidth : 0
    implicitHeight: loader.item ? loader.item.implicitHeight : 0

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
            label: control.descriptor.label || control.key
            from: control.descriptor.min
            to: control.descriptor.max
            stepSize: control.descriptor.step || 0
            defaultValue: control.descriptor["default"]
            unit: control.descriptor.unit || ""
            scale: control.descriptor.scale || "linear"
            confirmedValue: Number(control.confirmedValue)
            onMoved: function (value) { control.edited(value) }
        }
    }
    Component {
        id: toggle
        Toggle {
            enabled: control.enabled
            label: control.descriptor.label || control.key
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
            unavailable: control.unavailable
            confirmedValue: String(control.confirmedValue)
            onSelected: function (value) { control.edited(value) }
        }
    }

    // Accès pour les tests et les panneaux : contrôle effectivement créé.
    readonly property Item editor: loader.item
}
