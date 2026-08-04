!macro NSIS_HOOK_PREINSTALL
  LangString MUI_TEXT_WELCOME_INFO_TITLE ${LANG_ENGLISH} "Welcome to Muziso Setup"
  LangString MUI_TEXT_WELCOME_INFO_TEXT ${LANG_ENGLISH} "Setup will guide you through installing Muziso, your hybrid dark-themed desktop music player.\r\n\r\nIt is recommended that you close all other applications before starting Setup.\r\n\r\nClick Next to continue."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Copy non-delay-loadable GStreamer DLLs next to the exe
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\gobject-2.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\glib-2.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\ffi-7.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\intl-8.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\pcre2-8-0.dll" "$INSTDIR"
!macroend
