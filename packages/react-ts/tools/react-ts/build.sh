#!/bin/zsh
# React (Flow) -> TypeScript: regenerate the pipeline output packages/react-ts was made from (README.md).
#   REACT_SRC=<facebook/react checkout at the pinned tag> CODEMOD=<flow-to-typescript-codemod checkout, patched and built> \
#     tools/react-ts/build.sh <out dir>
# Optional: TS59=<typescript 5.9 package dir> (default: the compiler's TypeScript), TSC=<tsc for the final check> (default: the same).
set -e
setopt NULL_GLOB
TOOLS=${0:A:h}
PORT=${TOOLS:h:h}
REPO=${PORT:h:h}
R=${1:?out dir}
: ${REACT_SRC:?REACT_SRC: a facebook/react checkout at the pinned tag}
: ${CODEMOD:?CODEMOD: the flow-to-typescript-codemod checkout (codemod-arrow-parens.patch applied, built)}
TS59=${TS59:-$REPO/packages/compiler/node_modules/typescript}
TSC=${TSC:-node $TS59/bin/tsc}
rm -rf $R/in $R/folded && mkdir -p $R
cp -R $REACT_SRC/packages $R/in
# Forks the browser DOM client build never selects (scripts/rollup/forks.js): other host configs, other schedulers.
find $R/in/react-reconciler/src/forks -name 'ReactFiberConfig.*.js' ! -name 'ReactFiberConfig.dom.js' -delete
# The browser scheduler is scheduler/src/forks/Scheduler.js; the mock, native and postTask forks and the other builds' flag files go.
rm -f $R/in/scheduler/src/forks/SchedulerMock.js $R/in/scheduler/src/forks/SchedulerNative.js $R/in/scheduler/src/forks/SchedulerPostTask.js $R/in/scheduler/src/forks/SchedulerFeatureFlags.*.js
rm -rf $R/in/react-client/src/forks
python3 $TOOLS/flow-prepass.py $R/in $R/prepass-log.json
(cd $R && nice node $CODEMOD/dist/index.js convert -p in --write --disableFlow --useStrictAnyObjectType --useStrictAnyFunctionType --dropImportExtensions --convertUnannotated --ignore __tests__ __mocks__ server --stripPathsForIgnore --format json --output $R/report.json > $R/convert.log 2>&1 || true; tail -1 $R/convert.log; grep 'Error found in' $R/convert.log | sed 's/.*Error found in //' | cut -c1-200)
TS_PATH=$CODEMOD/node_modules/typescript nice node $TOOLS/fold-flags.cjs $R/in $R/folded
python3 $TOOLS/ts-postpass.py $R/folded $R/prepass-log.json
cp $PORT/tsconfig.json $PORT/react-ts-globals.ts $R/folded/
# Statements the flag fold left unreachable, then dead declarations and unused imports.
TS_PATH=$TS59 nice node $TOOLS/dropdead.cjs $R/folded
TS_PATH=$TS59 nice node --max-old-space-size=8192 $TOOLS/dce.cjs $R/folded | tail -1
(cd $R/folded && $TSC -p tsconfig.json > $R/tsc.txt 2>&1 || true)
echo "tsc errors: $(grep -c 'error TS' $R/tsc.txt) (the hand edits in packages/react-ts take this to 0)"
