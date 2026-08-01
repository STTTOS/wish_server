pnpm  --filter "@wishufree/*" build
mkdir -p ./dist/blog
mkdir -p ./dist/texas
mkdir -p ./dist/mart
cp -r ./apps/blog/dist/* ./dist/blog
cp -r ./apps/texas/dist/* ./dist/texas
cp -r ./apps/mart/dist/* ./dist/mart
