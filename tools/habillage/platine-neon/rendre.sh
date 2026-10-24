#!/bin/bash
cd $(dirname $0)
PAGE=platine-appli.html QS="mode=disque&d=6.8&ty=.05&tx=.08&el=33" node rendu-platine.mjs . disque 1012 900 0 3.64 25 > disque.log 2>&1
for k in 0 1 2 3 4 5 6 7 8; do lv=$(python3 -c "print($k/8)"); PAGE=platine-appli.html QS="mode=bras&leve=$lv&d=6.8&ty=.05&tx=.08&el=33" node rendu-platine.mjs . bras$k 1012 900 0 0 25 "0.5" > bras$k.log 2>&1; done
echo FINI > rendre.fini
