import QtQuick
import QtQuick.Controls
import "Theme.js" as Theme

// Choix d'un modèle parmi les options actuellement chargées par le moteur.
Row {
    id: selector
    property var options: []
    property string confirmedValue: ""
    property var unavailable: []
    property var optionInfo: []
    property string label: ""
    readonly property var availableOptions: options.filter(function (value) { return unavailable.indexOf(value) < 0; })
    signal selected(string value)

    spacing: 6
    Text {
        anchors.verticalCenter: parent.verticalCenter
        text: selector.label
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
        visible: selector.label !== ""
    }
    Row {
        spacing: 0
        Repeater {
            model: selector.availableOptions
            delegate: Rectangle {
                id: option
                required property string modelData
                required property int index
                readonly property bool current: modelData === selector.confirmedValue
                readonly property var info: selector.optionInfo.find(function (entry) { return entry.value === modelData; }) || ({})
                objectName: "option-" + modelData
                width: optionText.implicitWidth + 16
                height: 24
                color: current ? Theme.accent : Theme.panel2
                border.color: Theme.line
                opacity: !selector.enabled ? 0.45 : 1
                Text {
                    id: optionText
                    anchors.centerIn: parent
                    text: option.modelData
                    color: option.current ? "#101215" : Theme.text
                    font.pixelSize: Theme.fontSmall
                }
                MouseArea {
                    anchors.fill: parent
                    enabled: selector.enabled
                    onClicked: if (!option.current) selector.selected(option.modelData)
                }
                HoverHandler { id: optionHover }
                ToolTip.visible: optionHover.hovered && option.info.ugen !== undefined
                ToolTip.text: option.info.ugen + " — SynthDef " + option.info.synthDef
                              + "\nArguments DSP : " + option.info.args.join(", ")
                              + (option.info.implementation ? "\nConstruit avec : " + option.info.implementation.join(", ") : "")
                              + "\n" + Object.keys(option.info.mapping || {}).map(function (key) {
                                  return key + " : " + option.info.mapping[key];
                              }).join(" ; ")
                              + (option.info.availability ? "\n" + option.info.availability : "")
                ToolTip.delay: 500
            }
        }
    }
    Text {
        anchors.verticalCenter: parent.verticalCenter
        visible: selector.unavailable.indexOf(selector.confirmedValue) >= 0
        text: selector.confirmedValue + " indisponible (réglage enregistré)"
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
    }
}
