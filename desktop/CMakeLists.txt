cmake_minimum_required(VERSION 3.21)
project(mixette_desktop LANGUAGES CXX)

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
)
target_include_directories(desktop_core PUBLIC src)
target_link_libraries(desktop_core PUBLIC Qt6::Core Qt6::Network Qt6::WebSockets Qt6::Qml)

qt_add_executable(mixette-desktop src/main.cpp)
qt_add_qml_module(mixette-desktop
    URI Mixette.Desktop
    VERSION 1.0
    QML_FILES
        qml/Main.qml
)
target_link_libraries(mixette-desktop PRIVATE desktop_core Qt6::Gui Qt6::Quick Qt6::QuickControls2)
set_target_properties(mixette-desktop PROPERTIES WIN32_EXECUTABLE ON)

enable_testing()
set(DESKTOP_FIXTURES "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")

function(desktop_test name)
    qt_add_executable(${name} tests/${name}.cpp)
    target_link_libraries(${name} PRIVATE desktop_core Qt6::Test)
    target_compile_definitions(${name} PRIVATE DESKTOP_FIXTURES="${DESKTOP_FIXTURES}")
    add_test(NAME ${name} COMMAND ${name})
endfunction()

desktop_test(tst_statestore)
desktop_test(tst_apiclient)
