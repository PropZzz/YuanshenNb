package app.shixu.core.network

import app.shixu.core.network.generated.apis.*
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ClientServices @Inject constructor(
    val auth: AuthApi,
    val schedule: ScheduleApi,
    val energy: EnergyApi,
    val workspaces: WorkspacesApi,
    val biometrics: BiometricsApi,
    val tokens: TokenStore,
)

class ApiFailure(val status: Int, message: String) : Exception(message)

fun <T> Response<T>.requireBody(): T {
    if (!isSuccessful) {
        val problem = errorBody()?.string()?.let(ProblemDetailParser::parseRaw)
        throw ApiFailure(code(), problem?.let { "${it.detail} (${it.code.value})" } ?: "服务请求失败 (${code()})")
    }
    return body() ?: throw ApiFailure(code(), "服务端未返回有效内容")
}

fun Response<Unit>.requireSuccess() {
    if (!isSuccessful) requireBody()
}

fun Throwable.userMessage(): String = when (this) {
    is ApiFailure -> message ?: "请求失败"
    is java.io.IOException -> "无法连接服务。请检查网络后重试；尚未保存任何更改。"
    is IllegalArgumentException -> message ?: "请检查输入内容"
    else -> "暂时无法完成操作，请稍后重试。"
}
