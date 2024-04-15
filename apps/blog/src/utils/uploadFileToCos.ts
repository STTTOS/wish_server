import Cos from 'cos-nodejs-sdk-v5'

const cos = new Cos({
  // 推荐使用环境变量获取；用户的 SecretId，建议使用子账号密钥，授权遵循最小权限指引，降低使用风险。子账号密钥获取可参考https://cloud.tencent.com/document/product/598/37140
  SecretId: process.env.COS_SECRET_ID,
  // 推荐使用环境变量获取；用户的 SecretKey，建议使用子账号密钥，授权遵循最小权限指引，降低使用风险。子账号密钥获取可参考https://cloud.tencent.com/document/product/598/37140
  SecretKey: process.env.COS_SECRET_KEY
})

const uploadFileToCos = (
  appName: string,
  fileName: string,
  filePath: string
) => {
  // const formData = new FormData()

  return new Promise<string>((resolve, reject) => {
    cos.uploadFile(
      {
        /* 填入您自己的存储桶，必须字段 */
        Bucket: 'xuan-1313104191',
        /* 存储桶所在地域，例如ap-beijing，必须字段 */
        Region: 'ap-chengdu',
        /* 存储在桶里的对象键（例如1.jpg，a/b/test.txt），必须字段 */
        Key: `base/${appName}/${fileName}`,
        /* 必须，上传文件对象，可以是input[type="file"]标签选择本地文件后得到的file对象 */
        FilePath: filePath,
        /* 触发分块上传的阈值，超过5MB使用分块上传，非必须 */
        SliceSize: 1024 * 1024 * 3
      },
      function (err, data) {
        if (!err) {
          resolve(data.Location)
        } else {
          reject(err.message)
        }
      }
    )
  })
}
export default uploadFileToCos
