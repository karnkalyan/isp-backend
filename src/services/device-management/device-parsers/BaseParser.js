class BaseParser {
  result({items,columns,summary={},entityType,capabilityKey,warnings=[],confidence=1}) {
    return {
      items,
      columns,
      summary,
      entityType,
      capabilityKey,
      warnings,
      confidence,
      parser: this.constructor.name
    };
  }

  clean(lines) {
    return lines
      .map(line=>String(line||'').trim())
      .filter(line=>line&&!/^[=\-_*]{4,}$/.test(line))
      .filter(line=>!/(?:matching|total)\s+(?:services|entries|cards|vlans)/i.test(line));
  }
}

module.exports=BaseParser;
