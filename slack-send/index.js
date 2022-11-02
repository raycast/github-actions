const core = require('@actions/core')
const { IncomingWebhook } = require('@slack/webhook')

try {
  if (!core.getInput('webhook')) {
    throw new Error("'webhook' parameter is required")
  }
  const slack = new IncomingWebhook(core.getInput('webhook'))

  const env = process.env
  const evalInput = (str) => eval(`\`${str}\``)
  let color = evalInput(core.getInput('color'))
  let text = evalInput(core.getInput('text'))
  if (!text) {
    throw new Error("'text' parameter is required!")
  }
  (async () => {
    if (!color) {
        await slack.send(text)
    } else {
        await slack.send({attachments: [{text,color}]})
    }
  })();
} catch (error) {
  core.setFailed(error.message)
}