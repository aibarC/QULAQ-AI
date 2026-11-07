#!/bin/zsh
cd "$(dirname "$0")/.." || exit 1
if [ ! -d frontend/node_modules ] || [ ! -d backend/node_modules ]; then
  echo 'Сначала выполните npm run setup в корне проекта.'
  read -r '?Нажмите Enter, чтобы закрыть…'
  exit 1
fi
echo 'QULAQ: откройте http://127.0.0.1:5173'
npm run dev
