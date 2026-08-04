!macro NSIS_HOOK_POSTINSTALL
  ; Copy all GStreamer runtime DLLs next to the exe so OS loader finds them at startup
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\*.dll" "$INSTDIR"
!macroend
