const xmlEncode = require('../xmlEncode')

const htmlNodeParser = (node, id) => {
    let attrs = ''
    for (const attr in node.content) {
        attrs += ` ${[attr]}="${xmlEncode(node.content[attr])}"`
    }

    return `<HTML${attrs}${id} />`
}

module.exports = htmlNodeParser