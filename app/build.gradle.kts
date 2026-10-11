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
    signingConfigs {
        create("aurora") {
            storeFile = file("aurora.jks")
            storePassword = "auroramurmansk"
            keyAlias = "aurora"
            keyPassword = "auroramurmansk"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("aurora")
        }
        debug {
            signingConfig = signingConfigs.getByName("aurora")
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
