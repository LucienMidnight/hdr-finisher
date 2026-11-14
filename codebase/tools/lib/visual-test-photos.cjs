const path=require("node:path");
const reusePhoto=require("../../tests/helpers/reuse-test-photo.cjs");
const {CODEBASE}=require("./machine-settings.cjs");

module.exports=function visualTestPhotos(){
  const names=["DSC_3931_01.jpg","IMG_0790_finished.jpg","DJI_0071-2.JPG","_DSC6328.jpg","VKNS0418.JPEG","IMG_6717.PNG"];
  const files=names.map(name=>reusePhoto(reusePhoto.source(name),path.join(CODEBASE,"output/curated-visual-sources",name)));
  return path.dirname(files[0]);
};
