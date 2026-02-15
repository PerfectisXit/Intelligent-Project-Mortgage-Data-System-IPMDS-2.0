import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { message } from "antd";
import { API_STATUS } from "../constants";

// API 错误类
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30000, // 默认 30 秒超时
  headers: {
    "Content-Type": "application/json"
  }
});

// 请求拦截器
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 从 localStorage 获取用户角色
    const role = localStorage.getItem("user-role") || "finance";
    const userId = localStorage.getItem("user-id") || "u_finance_1";

    config.headers["x-user-role"] = role;
    config.headers["x-user-id"] = userId;

    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as { message?: string; code?: string } | undefined;

      switch (status) {
        case API_STATUS.UNAUTHORIZED:
          message.error("登录已过期，请重新登录");
          // 可以在这里触发重新登录逻辑
          break;
        case API_STATUS.FORBIDDEN:
          message.error("没有权限执行此操作");
          break;
        case API_STATUS.NOT_FOUND:
          message.error("请求的资源不存在");
          break;
        case API_STATUS.TIMEOUT:
          message.error("请求超时，请稍后重试");
          break;
        case API_STATUS.PAYLOAD_TOO_LARGE:
          message.error("文件过大，请上传小于 10MB 的文件");
          break;
        case API_STATUS.SERVER_ERROR:
          message.error("服务器错误，请稍后重试");
          break;
        default:
          message.error(data?.message || `请求失败 (${status})`);
      }

      return Promise.reject(
        new ApiError(
          data?.message || `HTTP ${status}`,
          data?.code || "UNKNOWN_ERROR",
          status,
          error
        )
      );
    } else if (error.request) {
      // 请求已发送但没有收到响应
      message.error("网络错误，请检查网络连接");
      return Promise.reject(
        new ApiError("Network Error", "NETWORK_ERROR", 0, error)
      );
    } else {
      // 请求配置出错
      message.error("请求配置错误");
      return Promise.reject(
        new ApiError("Request Config Error", "CONFIG_ERROR", 0, error)
      );
    }
  }
);

// 带重试的请求
export async function requestWithRetry<T>(
  requestFn: () => Promise<AxiosResponse<T>>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    if (retries > 0 && error instanceof ApiError && error.statusCode >= 500) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return requestWithRetry(requestFn, retries - 1, delay * 2);
    }
    throw error;
  }
}
