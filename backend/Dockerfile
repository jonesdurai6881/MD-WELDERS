FROM maven:3.9.16-eclipse-temurin-25 AS build
WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY backend/src backend/src
COPY database/migrations database/migrations
COPY database/postgresql-migrations database/postgresql-migrations
WORKDIR /workspace/backend
RUN mvn -B package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /workspace/backend/target/business-api-0.1.0.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
