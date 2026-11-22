package app.shixu.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.data.AppSessionState
import app.shixu.core.data.AuthRepository
import app.shixu.core.data.EnergyRepository
import app.shixu.core.data.RealtimeSyncCoordinator
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.WsEnergyOverloadAlertPayload
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AppRootUiState(
    val session: AppSessionState = AppSessionState.Bootstrapping,
    val todayEnergy: EnergyTodayResponse? = null,
    val isOfflineEnergy: Boolean = false,
    val overloadBanner: WsEnergyOverloadAlertPayload? = null,
)

@HiltViewModel
class AppSessionViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val energyRepository: EnergyRepository,
    private val realtimeSyncCoordinator: RealtimeSyncCoordinator,
) : ViewModel() {

    val uiState: StateFlow<AppRootUiState> = combine(
        authRepository.sessionState,
        energyRepository.todayEnergy,
        energyRepository.isOfflineSnapshot,
        realtimeSyncCoordinator.activeOverloadBanner,
    ) { session, energy, offlineEnergy, overload ->
        AppRootUiState(
            session = session,
            todayEnergy = energy,
            isOfflineEnergy = offlineEnergy,
            overloadBanner = overload,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = AppRootUiState(),
    )

    init {
        viewModelScope.launch {
            authRepository.bootstrap()
        }
    }

    fun onAppForegrounded() {
        realtimeSyncCoordinator.onAppForegrounded()
    }

    fun dismissSessionAlert() {
        authRepository.dismissAlertMessage()
    }

    fun dismissOverloadBanner() {
        realtimeSyncCoordinator.dismissOverloadBanner()
    }
}
