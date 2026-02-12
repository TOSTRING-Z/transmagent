const JSON5 = require("json5");

class XmlParser {
  /**
   * 解析 XML 字符串中的参数，支持类型自动转换和递归解析
   */
  static parseParams(paramsXml) {
    const params = {};
    if (!paramsXml) return params;

    const regex = /<([^>]+)>([\s\S]*?)<\/\1>/g;
    let match;

    while ((match = regex.exec(paramsXml)) !== null) {
      const key = match[1];
      let value = match[2].trim();

      // 检查是否是嵌套的XML结构
      if (value.includes('</')) {
        // 尝试解析为数组（多个相同标签）
        const itemRegex = new RegExp(`<([^>]+)>([\\s\\S]*?)<\\/\\1>`, 'g');
        const items = [];
        let itemMatch;
        
        // 临时存储所有匹配项
        const allMatches = [];
        while ((itemMatch = itemRegex.exec(value)) !== null) {
          allMatches.push({
            tag: itemMatch[1],
            content: itemMatch[2].trim()
          });
        }
        
        // 如果所有标签都相同，则解析为数组
        if (allMatches.length > 0) {
          const firstTag = allMatches[0].tag;
          const allSameTag = allMatches.every(m => m.tag === firstTag);
          
          if (allSameTag) {
            // 解析为对象数组
            const itemsArray = [];
            for (const item of allMatches) {
              if (item.content.includes('</')) {
                // 递归解析嵌套对象
                itemsArray.push(this.parseParams(item.content));
              } else {
                // 简单值
                itemsArray.push(this._convertValue(item.content));
              }
            }
            value = itemsArray;
          } else {
            // 不同标签，解析为对象
            const obj = {};
            for (const item of allMatches) {
              if (item.content.includes('</')) {
                // 递归解析嵌套对象
                obj[item.tag] = this.parseParams(item.content);
              } else {
                // 简单值
                obj[item.tag] = this._convertValue(item.content);
              }
            }
            value = obj;
          }
        } else {
          // 没有嵌套标签，按普通值处理
          value = this._convertValue(value);
        }
      } else {
        // 简单值，进行类型转换
        value = this._convertValue(value);
      }

      params[key] = value;
    }
    return params;
  }

  /**
   * 值类型转换辅助方法
   */
  static _convertValue(value) {
    // 智能类型转换
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try { 
        return JSON5.parse(value); 
      } catch (e) { 
        return value; // 保持为字符串
      }
    } else if (value.toLowerCase() === 'true') {
      return true;
    } else if (value.toLowerCase() === 'false') {
      return false;
    } else if (value.toLowerCase() === 'null') {
      return null;
    } else if (!isNaN(Number(value)) && value.trim() !== '') {
      return Number(value);
    }
    return value;
  }

  /**
   * 从 LLM 响应中提取 Thinking 和 Tool Call
   */
  static parseResponse(content) {
    // 1. 提取 Thinking
    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const thinking = thinkingMatch ? thinkingMatch[1].trim() : "";

    // 2. 提取 Tool Call
    const toolCallMatch = content.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    
    let toolName = "";
    let params = {};

    if (toolCallMatch) {
      const toolCallContent = toolCallMatch[1];
      const nameInner = toolCallContent.match(/<name>([\s\S]*?)<\/name>/i);
      if (nameInner) toolName = nameInner[1].trim();

      const paramsMatch = toolCallContent.match(/<parameters>([\s\S]*?)<\/parameters>/i);
      if (paramsMatch) {
        params = XmlParser.parseParams(paramsMatch[1]);
      }
    }

    return { thinking, toolName, params };
  }
}

module.exports = XmlParser;