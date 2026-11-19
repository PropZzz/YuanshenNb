# 保留 kotlinx.serialization 与 Retrofit 生成类反射/序列化规则
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class * {
    @kotlinx.serialization.Serializable <methods>;
}
-keepclassmembers class app.shixu.core.network.generated.** { *; }
