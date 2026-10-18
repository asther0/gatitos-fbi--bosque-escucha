#!/bin/zsh
cd "${0:A:h}"
for bosque_python in "$PWD/local-center/.venv-ml/bin/python" /tmp/bosque-ml-venv/bin/python; do
  if [[ -x "$bosque_python" ]] && "$bosque_python" -c 'import uvicorn, dotenv, tensorflow, soundfile' >/dev/null 2>&1; then
    "$bosque_python" local-center/mvp.py
    bosque_exit=$?
    if [[ $bosque_exit -ne 0 ]]; then
      echo 'No se pudo iniciar el MVP. El detalle del error aparece arriba.'
      read 'bosque_reply?Pulsa Enter para cerrar.'
    fi
    exit $bosque_exit
  fi
done
echo 'No se encontró el entorno Python del proyecto. No cambies de red todavía.'
read 'bosque_reply?Pulsa Enter para cerrar.'
exit 1
