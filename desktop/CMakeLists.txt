cmake_minimum_required(VERSION 3.21)
project(scmixer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 6.12 REQUIRED COMPONENTS Core Gui Network WebSockets Qml Quick QuickControls2 Test QuickTest)

qt_standard_project_setup(REQUIRES 6.8)

# Couche cliente de l'API moteur : sans interface graphique, testée seule.
add_library(desktop_core STATIC
    src/HttpTransport.h src/HttpTransport.cpp
    src/EventChannel.h src/EventChannel.cpp
    src/ApiClient.h src/ApiClient.cpp
    src/SourceListModel.h src/SourceListModel.cpp
    src/StateStore.h src/StateStore.cpp
    src/CurveMath.h src/CurveMath.cpp
    src/TimoxVasioClient.h src/TimoxVasioClient.cpp
)
target_include_directories(desktop_core PUBLIC src)
target_link_libraries(desktop_core PUBLIC Qt6::Core Qt6::Network Qt6::WebSockets Qt6::Qml)

qt_add_executable(scmixer src/main.cpp)
qt_add_qml_module(scmixer
    URI SCMixer.Desktop
    VERSION 1.0
    QML_FILES
        qml/Main.qml
        qml/controls/Theme.js
        qml/controls/RangeControl.qml
        qml/controls/Knob.qml
        qml/controls/Fader.qml
        qml/controls/Meter.qml
        qml/controls/Toggle.qml
        qml/controls/ModelSelector.qml
        qml/controls/ErrorBanner.qml
        qml/controls/ParameterControl.qml
        qml/controls/Contract.js
        qml/controls/StageControls.qml
        qml/controls/ActionButton.qml
        qml/controls/ChainStrip.qml
        qml/graphs/FrequencyGraph.qml
        qml/graphs/TransferGraph.qml
        qml/graphs/StereoPosition.qml
        qml/panels/pages/CompressorView.qml
        qml/panels/pages/FiltersPage.qml
        qml/panels/pages/EqPage.qml
        qml/panels/pages/MultibandPage.qml
        qml/panels/pages/HighPassPage.qml
        qml/panels/pages/LimiterPage.qml
        qml/panels/pages/CompactPage.qml
        qml/panels/ProcessingWorkspace.qml
        qml/panels/OutputStrip.qml
        qml/panels/SourceStrip.qml
        qml/panels/SourceDialog.qml
        qml/tabs/ConsoleTab.qml
        qml/tabs/ProcessingTab.qml
        qml/controls/ConfirmButton.qml
        qml/tabs/PresetsTab.qml
        qml/tabs/EngineTab.qml
        qml/panels/NodeTree.qml
        qml/panels/BenchPanel.qml
        qml/tabs/RoutingTab.qml
        qml/tabs/LogTab.qml
        qml/panels/EngineBar.qml
        qml/panels/RecordBar.qml
)
target_link_libraries(scmixer PRIVATE desktop_core Qt6::Gui Qt6::Quick Qt6::QuickControls2)
set_target_properties(scmixer PROPERTIES WIN32_EXECUTABLE ON)

enable_testing()
set(DESKTOP_FIXTURES "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
set(DESKTOP_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}")

function(desktop_test name)
    qt_add_executable(${name} tests/${name}.cpp)
    target_link_libraries(${name} PRIVATE desktop_core Qt6::Test)
    target_compile_definitions(${name} PRIVATE DESKTOP_FIXTURES="${DESKTOP_FIXTURES}" DESKTOP_SOURCES="${DESKTOP_SOURCES}")
    add_test(NAME ${name} COMMAND ${name})
endfunction()

desktop_test(tst_statestore)
desktop_test(tst_apiclient)
desktop_test(tst_curvemath)
desktop_test(tst_noranges)
desktop_test(tst_timoxvasio)

# Tests QML (QuickTest) : composants chargés depuis qml/ par import de répertoire.
qt_add_executable(tst_qml tests/tst_qml.cpp)
target_link_libraries(tst_qml PRIVATE desktop_core Qt6::Quick Qt6::QuickControls2 Qt6::QuickTest)
target_compile_definitions(tst_qml PRIVATE DESKTOP_FIXTURES="${DESKTOP_FIXTURES}" QUICK_TEST_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/qml")
add_test(NAME tst_qml COMMAND tst_qml)
