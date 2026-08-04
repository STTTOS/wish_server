pnpm  --filter "@wishufree/*" build
mkdir -p ./dist/blog
mkdir -p ./dist/texas
mkdir -p ./dist/mart
mkdir -p ./dist/printer
cp -r ./apps/blog/dist/* ./dist/blog
cp -r ./apps/texas/dist/* ./dist/texas
cp -r ./apps/mart/dist/* ./dist/mart
cp -r ./apps/printer/dist/* ./dist/printer
# H5 静态页随部署目录带出
mkdir -p ./dist/printer/public
cp -r ./apps/printer/public/* ./dist/printer/public/ 2>/dev/null || true
