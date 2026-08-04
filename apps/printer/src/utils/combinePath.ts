const combinePath = (apiPrefix: string) => (model: string) => (op: string) =>
  apiPrefix + model + op

export default combinePath
