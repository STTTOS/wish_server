pnpm  --filter "@wishufree/*" build
mkdir -p ./dist/blog
mkdir -p ./dist/finance
cp -r ./apps/blog/dist/* ./dist/blog
cp -r ./apps/finance/dist/* ./dist/finance

