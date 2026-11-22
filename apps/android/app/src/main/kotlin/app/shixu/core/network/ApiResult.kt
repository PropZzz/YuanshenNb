package app.shixu.core.network

import app.shixu.core.network.generated.models.ErrorCode
import app.shixu.core.network.generated.models.ProblemDetail
import kotlinx.coroutines.CancellationException
import retrofit2.Response
import java.io.IOException

sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class HttpError(
        val httpCode: Int,
        val problem: ProblemDetail?,
        val rawMessage: String,
    ) : ApiResult<Nothing>

    data class NetworkError(
        val cause: Throwable,
        val isOffline: Boolean,
    ) : ApiResult<Nothing>
}

suspend fun <T> safeApiCall(call: suspend () -> Response<T>): ApiResult<T> {
    return try {
        val response = call()
        if (response.isSuccessful) {
            val body = response.body()
            if (body != null) {
                ApiResult.Success(body)
            } else {
                ApiResult.HttpError(
                    httpCode = response.code(),
                    problem = null,
                    rawMessage = "服务端返回空响应体 (${response.code()})",
                )
            }
        } else {
            val problem = ProblemDetailParser.parse(response)
            ApiResult.HttpError(
                httpCode = response.code(),
                problem = problem,
                rawMessage = problem?.detail ?: response.message().ifBlank { "HTTP ${response.code()}" },
            )
        }
    } catch (ce: CancellationException) {
        throw ce
    } catch (io: IOException) {
        ApiResult.NetworkError(cause = io, isOffline = true)
    } catch (t: Throwable) {
        ApiResult.NetworkError(cause = t, isOffline = false)
    }
}

suspend fun safeUnitApiCall(call: suspend () -> Response<Unit>): ApiResult<Unit> {
    return try {
        val response = call()
        if (response.isSuccessful) {
            ApiResult.Success(Unit)
        } else {
            val problem = ProblemDetailParser.parse(response)
            ApiResult.HttpError(
                httpCode = response.code(),
                problem = problem,
                rawMessage = problem?.detail ?: response.message().ifBlank { "HTTP ${response.code()}" },
            )
        }
    } catch (ce: CancellationException) {
        throw ce
    } catch (io: IOException) {
        ApiResult.NetworkError(cause = io, isOffline = true)
    } catch (t: Throwable) {
        ApiResult.NetworkError(cause = t, isOffline = false)
    }
}

object ErrorMessageMapper {
    fun messageFor(result: ApiResult.HttpError): String =
        messageFor(result.problem?.code, result.problem?.detail ?: result.rawMessage)

    fun messageFor(result: ApiResult.NetworkError): String =
        if (result.isOffline) {
            "网络连接不可用，已切换或保留本地离线模式"
        } else {
            result.cause.localizedMessage ?: "请求发生意外异常"
        }

    fun messageFor(code: ErrorCode?, fallbackDetail: String?): String {
        val detail = fallbackDetail?.takeIf { it.isNotBlank() }
        return when (code) {
            ErrorCode.BAD_REQUEST -> detail ?: "请求格式有误，请检查输入参数"
            ErrorCode.UNAUTHORIZED -> "登录凭证已失效，正在尝试刷新会话"
            ErrorCode.INVALID_CREDENTIALS -> "账号或密码错误，请核对后重试"
            ErrorCode.INVALID_REFRESH_TOKEN -> "登录状态已过期，请重新登录"
            ErrorCode.TOKEN_REUSE_DETECTED -> "检测到会话异常（令牌重放），为保障安全已吊销全部会话，请重新登录"
            ErrorCode.INVALID_WS_TICKET -> "实时推送握手票据已过期，正在重连"
            ErrorCode.FORBIDDEN -> detail ?: "您无权执行当前操作"
            ErrorCode.FORBIDDEN_NOT_WORKSPACE_MEMBER -> "您已不是该团队工作区成员"
            ErrorCode.FORBIDDEN_INSUFFICIENT_ROLE -> "仅会议发起人或工作区管理员可执行此操作"
            ErrorCode.FORBIDDEN_NOT_MEETING_PARTICIPANT -> "您不在该团队会议受邀名单中"
            ErrorCode.NOT_FOUND -> detail ?: "目标记录不存在或已被移除"
            ErrorCode.INVITE_CODE_NOT_FOUND -> "团队邀请码无效或已失效，请核对后重试"
            ErrorCode.MEETING_PROPOSAL_NOT_FOUND -> "该团队会议提案不存在或已被删除"
            ErrorCode.SNAPSHOT_NOT_FOUND -> "该救援快照记录不存在"
            ErrorCode.METHOD_NOT_ALLOWED -> "客户端接口方法与服务端不匹配"
            ErrorCode.CONFLICT -> detail ?: "数据状态发生冲突，请刷新后重试"
            ErrorCode.EMAIL_ALREADY_EXISTS -> "该邮箱已注册，请直接登录"
            ErrorCode.ALREADY_WORKSPACE_MEMBER -> "您已经加入该团队工作区"
            ErrorCode.CONFLICT_SCHEDULE_OVERLAP -> detail ?: "当前时段与既有硬锁定日程或团队会议重叠"
            ErrorCode.CONFLICT_MEMBER_BUSY -> detail ?: "部分必选成员该时段已被占用，正在为您刷新候选黄金窗口"
            ErrorCode.MEETING_MANAGED_BY_PROPOSAL -> "团队会议不可在个人日历直接改期或删除，请通过会议回执或由组织者取消"
            ErrorCode.MEETING_ALREADY_CANCELLED -> "该团队会议已被取消"
            ErrorCode.STALE_BASELINE_VERSION -> "您的日程刚刚发生变更，正在重新加载最新救援方案"
            ErrorCode.ALREADY_REVERTED -> "该救援方案此前已撤销"
            ErrorCode.SNAPSHOT_RESTORE_CONFLICT -> detail ?: "原时段已被之后新增的硬锁定日程或团队会议占用，无法静默还原"
            ErrorCode.VALIDATION_FAILED -> detail ?: "提交字段校验未通过，请检查表单内容"
            ErrorCode.RANGE_TOO_LARGE -> "单次查询时间跨度超出服务端限制，已自动收敛查询范围"
            ErrorCode.INVALID_TIME_RANGE -> "结束时间必须晚于开始时间"
            ErrorCode.DEADLINE_IN_PAST -> "紧急任务截止时间必须晚于当前时间"
            ErrorCode.INVALID_BIOMETRIC_SAMPLE -> "存在超出合理生理范围的样本，系统已自动隔离异常点"
            ErrorCode.INVALID_WORK_HOURS -> "工作日结束时间必须晚于开始时间，且专注窗口不可越界"
            ErrorCode.PARTICIPANT_NOT_IN_WORKSPACE -> "所选参会人中包含非当前工作区成员，已刷新成员名册"
            ErrorCode.TOO_MANY_REQUESTS -> "请求过于频繁，请稍后重试"
            ErrorCode.INTERNAL_SERVER_ERROR -> detail ?: "服务端处理异常，请稍后重试"
            ErrorCode.SERVICE_UNAVAILABLE -> "服务端暂时不可用，当前保留本地离线缓冲"
            null -> detail ?: "操作未能完成，请稍后重试"
        }
    }
}
