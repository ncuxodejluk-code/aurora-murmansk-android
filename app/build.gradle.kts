plugins {
    id("com.android.application")
}

// Номер сборки GitHub Actions — чтобы каждая новая версия ставилась поверх старой.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "ru.murmansk.aurora"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.murmansk.aurora"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // Один и тот же ключ для всех сборок, иначе обновление не установится поверх.
    // Ключ лежит в репозитории только в зашифрованном виде (app/signing/release.p12.enc),
    // а пароль — в секрете GitHub AURORA_SIGNING_PASSWORD. Сборка в GitHub Actions расшифровывает
    // ключ и передаёт путь и пароль через переменные окружения.
    // Без них (например, сборка у себя) APK подписывается обычным отладочным ключом.
    val releaseKeystore = System.getenv("AURORA_KEYSTORE")
    val signingPassword = System.getenv("AURORA_SIGNING_PASSWORD")
    signingConfigs {
        if (releaseKeystore != null && signingPassword != null) {
            create("aurora") {
                storeFile = file(releaseKeystore)
                storePassword = signingPassword
                keyAlias = "aurora"
                keyPassword = signingPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("aurora") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

base {
    archivesName.set("aurora-murmansk")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}
