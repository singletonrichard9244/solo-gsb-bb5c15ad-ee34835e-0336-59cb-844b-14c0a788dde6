async function request(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`服务响应异常（HTTP ${res.status}）`);
  }
  if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  return data;
}

export function inferSchema(samples) {
  return request("/api/infer", { samples });
}

export function validateSample(schema, sample) {
  return request("/api/validate", { schema, sample });
}

export function diffSchemas(oldSchema, newSchema, perspective) {
  return request("/api/diff", { oldSchema, newSchema, perspective });
}
