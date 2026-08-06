!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR"
  DetailPrint "Relocating GStreamer DLLs to application root..."
  CopyFiles /SILENT "$INSTDIR\resources\gstreamer\bin\*.dll" "$INSTDIR\"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\*.dll" "$INSTDIR\"
  CopyFiles /SILENT "$INSTDIR\resources\*.dll" "$INSTDIR\"
!macroend

!macro customInstall
  SetOutPath "$INSTDIR"
  DetailPrint "Relocating GStreamer DLLs to application root..."
  CopyFiles /SILENT "$INSTDIR\resources\gstreamer\bin\*.dll" "$INSTDIR\"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\*.dll" "$INSTDIR\"
  CopyFiles /SILENT "$INSTDIR\resources\*.dll" "$INSTDIR\"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\*.dll"
!macroend




